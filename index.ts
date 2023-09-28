
import { Handler } from 'aws-lambda';

import { GitlabRole, GitlabRoleMapping, GitlabAccessUpdate, GitlabAccessUpdateOperation, GitlabUserUpdate, GitlabUserUpdateOperation } from './src/gitlab/types';
import { GitlabScim } from './src/gitlab/scim';
import { GitlabApi } from './src/gitlab/api';
import { Google } from './src/google';
import { logger } from "./src/utils/logging";
import { getGroupPrivilege, getUserCustomMembership, loadMappings } from "./src/utils/mappings";
import { Slack } from './src/utils/slack';


const GOOGLE_GROUP_FILTER = process.env.GOOGLE_GROUP_FILTER || "*";
const DEFAULT_MEMBERSHIP_ROLE: GitlabRole = GitlabRoleMapping[process.env.DEFAULT_MEMBERSHIP_ROLE || 'Minimal Access']
const DRY_RUN = (process.env.DRY_RUN || "false") !== "false"
const GITLAB_GROUP = process.env.GITLAB_GROUP!

const google = new Google()
await google.initialize()
const gitlabScim = new GitlabScim()
const gitlabApi = new GitlabApi()
let slack: Slack | null = null;


if (process.env.SLACK_WEBHOOK_URL !== undefined) {
  slack = new Slack()
}

logger.debug("clients initialized")

async function getGoogleUserGroups(): Promise<{ [key: string]: string[] }> {
  const userGroups: { [key: string]: string[] } = {}

  const groupFilter: string[] = []
  GOOGLE_GROUP_FILTER.split(",").forEach((group) => groupFilter.push(group.trim()))

  const googleGroups = await google.listGroups(groupFilter)
  for (const group of googleGroups) {
    logger.debug(`listing members for google group ${group.email}`)
    const members = await google.listGroupMembers(group.id)
    for (const member of members) {
      if (!userGroups.hasOwnProperty(member.email)) {
        userGroups[member.email] = []
      }

      userGroups[member.email].push(group.email)
    }
  }

  return userGroups
}


async function execute() {
  const mappings = await loadMappings()

  // Get all users and memberships

  const userGroups: { [key: string]: string[] } = await getGoogleUserGroups()
  const googleUsers = await google.listUsers(Object.keys(userGroups))
  logger.debug("retrieved google users")
  const gitlabScimUsers = await gitlabScim.listScimUsers()
  logger.debug("retrieved gitlab scim users")
  const gitlabUsers = await gitlabApi.listGroupSamlMembers()
  logger.debug("retrieved gitlab group users")
  // Compute updates to execute

  const membershipUpdates: GitlabAccessUpdate[] = []
  const userUpdates: GitlabUserUpdate[] = []
  const leftOverUsers = Object.keys(gitlabScimUsers)

  // check which users need to be added
  for (const email of Object.keys(userGroups)) {
    if (Object.keys(gitlabScimUsers).includes(email)) {
      if (gitlabScimUsers[email].active) { // user is active, we'll compare
        continue
      }

      userUpdates.push({
        user: gitlabScimUsers[email],
        op: GitlabUserUpdateOperation.ACTIVATE,
        notes: email
      })
    } else {
      // if a google user is not a scim user, add it and its custom memberships

      userUpdates.push({
        user: googleUsers[email],
        op: GitlabUserUpdateOperation.ADD,
        notes: email,
      })
    }

    const membership = getUserCustomMembership(email, userGroups[email], mappings)
    if (membership[GITLAB_GROUP] === undefined) {
      membershipUpdates.push({
        user: email,
        group: GITLAB_GROUP,
        role: getGroupPrivilege(DEFAULT_MEMBERSHIP_ROLE, GITLAB_GROUP, membership),
        op: GitlabAccessUpdateOperation.ADD,
        notes: email,
      })
    }

    for (const key of Object.keys(membership)) {
      membershipUpdates.push({
        user: email,
        group: key,
        role: membership[key],
        op: GitlabAccessUpdateOperation.ADD,
        notes: email,
      })
    }

    leftOverUsers.splice(leftOverUsers.indexOf(email), 1)
  }

  // check which users need to be removed or activate
  for (const email of leftOverUsers) {
    if (!gitlabScimUsers[email].active) {
      continue
    }

    // user does not exist in google, or is suspended in google, and is active in gitlab: remove
    if (!Object.keys(googleUsers).includes(email) || googleUsers[email].suspended) {
      userUpdates.push({
        user: gitlabScimUsers[email],
        op: GitlabUserUpdateOperation.REMOVE,
        notes: email,
      })
      continue
    }

    const expectedMembership = getUserCustomMembership(email, userGroups[email], mappings)
    const currentMembership = await gitlabApi.listUserMembership(gitlabUsers[email].id)

    if (currentMembership.length === 0 && Object.keys(expectedMembership).length > 0) {
      for (const key of Object.keys(expectedMembership)) {
        membershipUpdates.push({
          user: email,
          group: key,
          role: expectedMembership[key],
          op: GitlabAccessUpdateOperation.ADD,
          notes: email,
        })
      }
      continue
    }

    const leftOverMembership = Object.assign({}, expectedMembership);
    for (const item of currentMembership) {
      if (expectedMembership[item.source_full_name] === undefined) {
        const userDefaultMembership = getGroupPrivilege(DEFAULT_MEMBERSHIP_ROLE, item.source_full_name, expectedMembership)

        if (item.access_level.integer_value !== userDefaultMembership) {
          membershipUpdates.push({
            user: gitlabUsers[email].id,
            group: item.source_full_name,
            role: userDefaultMembership,
            op: shouldDelete(item.source_full_name, userDefaultMembership),
            notes: email,
          })
        }
      } else {
        delete leftOverMembership[item.source_full_name]
        if (expectedMembership[item.source_full_name] !== item.access_level.integer_value) {
          membershipUpdates.push({
            user: gitlabUsers[email].id,
            group: item.source_full_name,
            role: expectedMembership[item.source_full_name],
            op: shouldDelete(item.source_full_name, expectedMembership[item.source_full_name]),
            notes: email,
          })
        }
      }
    }

    for (const key of Object.keys(leftOverMembership)) {
      membershipUpdates.push({
        user: email,
        group: key,
        role: leftOverMembership[key],
        op: GitlabAccessUpdateOperation.ADD,
        notes: email,
      })
    }
  }

  logger.info(`User updates:`)
  userUpdates.forEach(update => {
    console.log(JSON.stringify({
      op: update.op,
      notes: update.notes,
    }))
  })

  logger.info(`Membership updates:`)
  membershipUpdates.forEach(update => {
    console.log(JSON.stringify({
      notes: update.notes,
      op: update.op,
      role: update.role,
      group: update.group,
    }))
  })

  if (DRY_RUN) {
    logger.info("Dry run is on, not committing any change")
    return
  }

  for (const update of userUpdates) {
    logger.debug(`updating ${update.user} status: ${update.op}`)

    await gitlabScim.updateUser(update)
  }

  for (const update of membershipUpdates) {
    logger.debug(`changing ${update.notes} access for group ${update.group} to ${update.role}`)

    await gitlabApi.changeUserAccessLevel(update)
  }

  if (slack !== null) {
    slack.notify(userUpdates, membershipUpdates)
  }
}

function shouldDelete(group: string, role: GitlabRole): GitlabAccessUpdateOperation {
  return (role < 10 && group !== GITLAB_GROUP) ? GitlabAccessUpdateOperation.REMOVE : GitlabAccessUpdateOperation.UPDATE
}

if (
  process.env.LAMBDA_TASK_ROOT === undefined &&  // AWS lambdas
  process.env.AWS_SAM_LOCAL === undefined &&  // AWS SAM
  process.env.FUNCTION_SIGNATURE_TYPE === undefined // google cloud functions
) {
  execute()
}

export const handler: Handler = async () => {
  logger.debug("Starting execution")
  await execute()
  logger.debug("Finished execution")

  return {}
};
