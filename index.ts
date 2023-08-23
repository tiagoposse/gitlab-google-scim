
import { Handler } from 'aws-lambda';

import { GitlabRole, GitlabRoleMapping, GitlabAccessUpdate, GitlabAccessUpdateOperation, GitlabUserUpdate, GitlabUserUpdateOperation } from './src/gitlab/types';
import { GitlabScim } from './src/gitlab/scim';
import { GitlabApi } from './src/gitlab/api';
import { Google } from './src/google';
import { logger } from "./src/utils/logging";
import { PrivilegeMap, loadMappings } from "./src/utils/mappings";
import { Slack } from './src/utils/slack';


const GOOGLE_GROUP_FILTER = process.env.GOOGLE_GROUP_FILTER || "*";
const DEFAULT_MEMBERSHIP_ROLE: GitlabRole = GitlabRoleMapping[process.env.DEFAULT_MEMBERSHIP_ROLE || 'Minimal Access']
const DRY_RUN = (process.env.DRY_RUN || "0") !== "0"
const GITLAB_GROUP = process.env.GITLAB_GROUP!

const google = new Google()
await google.initialize()
const gitlabScim = new GitlabScim()
const gitlabApi = new GitlabApi()
const slack = new Slack()


async function getGoogleUserGroups(): Promise<{ [key: string]: string[] }> {
  const userGroups: { [key: string]: string[] } = {}

  const groupFilter: string[] = []
  GOOGLE_GROUP_FILTER.split(",").forEach((group) => groupFilter.push(group.trim()))

  const googleGroups = await google.listGroups(groupFilter)
  for (const group of googleGroups) {
    logger.debug(`listing google groups for ${group.email}`)
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

function getUserCustomMembership(email: string, groups: string[], mappings: PrivilegeMap): { [key: string]: GitlabRole } {
  logger.debug(`retrieve membership of user ${email}`)

  const membership: { [key: string]: GitlabRole } = {}

  if (mappings.users.hasOwnProperty(email)) {
    for (var gitlabGroup of Object.keys(mappings.users[email])) {
      membership[gitlabGroup] = GitlabRoleMapping[mappings.users[email][gitlabGroup]]
    }
  } else {
    for (const userGroup of groups) {
      if (mappings.groups[userGroup] !== undefined) {
        for (var gitlabGroup of Object.keys(mappings.groups[userGroup])) {
          if (!membership.hasOwnProperty(gitlabGroup)) {
            membership[gitlabGroup] = GitlabRoleMapping[mappings.groups[userGroup][gitlabGroup]]
          }
        }
        break
      }
    }
  }

  return membership
}

async function execute() {
  const mappings = await loadMappings()

  // Get all users and memberships

  const userGroups: { [key: string]: string[] } = await getGoogleUserGroups()
  const googleUsers = await google.listUsers(Object.keys(userGroups))
  const gitlabScimUsers = await gitlabScim.listScimUsers()
  const gitlabUsers = await gitlabApi.listGroupSamlMembers()

  // Compute updates to execute

  const membershipUpdates: GitlabAccessUpdate[] = []
  const userUpdates: GitlabUserUpdate[] = []

  // check which users need to be added
  for (const email of Object.keys(userGroups)) {
    if (Object.keys(gitlabScimUsers).includes(email)) {
      continue
    }
    // if a google user is not a scim user, add it and its custom memberships

    userUpdates.push({
      user: googleUsers[email],
      op: GitlabUserUpdateOperation.ADD
    })

    const membership = getUserCustomMembership(email, userGroups[email], mappings)
    for (const key of Object.keys(membership)) {
      membershipUpdates.push({
        user: email,
        group: key,
        role: membership[key],
        op: GitlabAccessUpdateOperation.ADD
      })
    }
  }

  // check which users need to be removed or activate
  for (const email of Object.keys(gitlabScimUsers)) {
    if (!Object.keys(googleUsers).includes(email) && gitlabScimUsers[email].active) { // user does not exist in google and is active in gitlab: remove
      userUpdates.push({
        user: gitlabScimUsers[email],
        op: GitlabUserUpdateOperation.REMOVE
      })
      continue
    } else if (
      Object.keys(googleUsers).includes(email) &&
      googleUsers[email].suspended != !gitlabScimUsers[email].active
    ) { // user exists in both gitlab and google and their status differ
      if (googleUsers[email].suspended) { // google user is suspended but gitlab user is active: remove
        userUpdates.push({
          user: gitlabScimUsers[email],
          op: GitlabUserUpdateOperation.REMOVE
        })
        continue
      } else if (!googleUsers[email].suspended) { // google user is active but gitlab user is inactive: activate
        userUpdates.push({
          user: gitlabScimUsers[email],
          op: GitlabUserUpdateOperation.ACTIVATE
        })
      }
    }

    // will only reach here if the user is either to be activated or active in both google and gitlab

    const expectedMembership = getUserCustomMembership(email, userGroups[email], mappings)
    const currentMembership = await gitlabApi.listUserMembership(gitlabUsers[email].id)


    if (currentMembership.length === 0 && Object.keys(expectedMembership).length > 0) {
      expectedMembership
      for (const key of Object.keys(expectedMembership)) {
        membershipUpdates.push({
          user: email,
          group: key,
          role: expectedMembership[key],
          op: GitlabAccessUpdateOperation.ADD
        })
      }
      continue
    }

    for (const item of currentMembership) {
      if (expectedMembership[item.source_full_name] === undefined) {
        if (item.access_level.integer_value !== DEFAULT_MEMBERSHIP_ROLE) {
          membershipUpdates.push({
            user: gitlabUsers[email].id,
            group: item.source_full_name,
            role: DEFAULT_MEMBERSHIP_ROLE,
            op: shouldDelete(item.source_full_name, DEFAULT_MEMBERSHIP_ROLE)
          })
        }
      } else if (expectedMembership[item.source_full_name] !== item.access_level.integer_value) {
        membershipUpdates.push({
          user: gitlabUsers[email].id,
          group: item.source_full_name,
          role: expectedMembership[item.source_full_name],
          op: shouldDelete(item.source_full_name, expectedMembership[item.source_full_name])
        })
      }
    }
  }

  logger.info(`User updates:`)
  logger.info(JSON.stringify(membershipUpdates))

  logger.info(`Membership updates:`)
  logger.info(JSON.stringify(membershipUpdates))

  if (DRY_RUN) {
    logger.info("Dry run is on, not committing any change")
    return
  }

  for (const update of userUpdates) {
    logger.debug(`updating ${update.user} status: ${update.op}`)

    await gitlabScim.updateUser(update)
  }

  for (const update of membershipUpdates) {
    logger.debug(`changing ${update.user} access for group ${update.group} to ${update.role}`)

    await gitlabApi.changeUserAccessLevel(update)
  }

  if (slack.active()) {
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
  await execute()

  return {}
};

export default handler;
