import { GitlabRole, GitlabRoleMapping } from '../gitlab/types';
import { load } from "js-yaml";
import { getSecretFromAws } from './aws';
import { logger } from './logging';
import fs from 'fs';

async function resolveMappings(): Promise<string> {
  if (process.env.ROLE_MAPPINGS_SECRET !== undefined) {
    return await getSecretFromAws(process.env.ROLE_MAPPINGS_SECRET)
  }

  if (process.env.ROLE_MAPPINGS_FILE !== undefined) {
    if (fs.existsSync(process.env.ROLE_MAPPINGS_FILE)) {
      throw Error(`Role mappings file does not exist: ${process.env.ROLE_MAPPINGS_FILE}`)
    }
    return (fs.readFileSync(process.env.ROLE_MAPPINGS_FILE)).toString()
  }

  if (process.env.ROLE_MAPPINGS !== undefined) {
    return process.env.ROLE_MAPPINGS
  }

  return '{"groups":{},"users":{}}'
}

export type PrivilegeMap = {
  groups: { [key: string]: { [key: string]: string } }
  users: { [key: string]: { [key: string]: string } }
}

function validateMappings(mappings: PrivilegeMap) {
  for (var type of ["user", "group"]) {
    let toIterate: { [key: string]: { [key: string]: string } }
    if (type === "user") {
      toIterate = mappings.users
    } else {
      toIterate = mappings.groups
    }

    for (const googleGroup of Object.keys(toIterate)) {
      const regexp = new RegExp(/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
      if (!googleGroup.match(regexp)) {
        throw Error(`google ${type} ${googleGroup} is not an email`)
      }

      for (const gitlabGroup of Object.keys(toIterate[googleGroup])) {
        if (!GitlabRoleMapping.hasOwnProperty(toIterate[googleGroup][gitlabGroup])) {
          throw Error(`gitlab permission ${toIterate[googleGroup][gitlabGroup]} is invalid`)
        }
      }
    }
  }
}

export async function loadMappings(): Promise<PrivilegeMap> {
  const content = await resolveMappings()

  const mappings = load(content, { json: true }) as PrivilegeMap
  validateMappings(mappings)

  logger.debug("Mappings:")
  logger.debug(JSON.stringify(mappings))
  return mappings
}

export function getGroupPrivilege(defaultRole: GitlabRole, gitlabGroup: string, membership: { [key: string]: GitlabRole }): GitlabRole {
  const parts = gitlabGroup.split("/")
  let level = defaultRole

  for (var index = parts.length; index > 0; index--) {
    const path = parts.slice(0, index).join("/")

    if (membership[path] !== undefined && membership[path] > level) {
      level = membership[path]
    }
  }

  return level
}

export function getUserCustomMembership(email: string, groups: string[], mappings: PrivilegeMap): { [key: string]: GitlabRole } {
  logger.debug(`retrieve membership of user ${email}`)

  const membership: { [key: string]: GitlabRole } = {}

  if (mappings.users[email] !== undefined) {
    Object.keys(mappings.users[email]).forEach(gitlabGroup => {
      membership[gitlabGroup] = GitlabRoleMapping[mappings.users[email][gitlabGroup]]
    })
  } else {
    for (const userGroup of groups) {
      if (mappings.groups.hasOwnProperty(userGroup)) {
        for (const gitlabGroup of Object.keys(mappings.groups[userGroup])) {
          if (!membership.hasOwnProperty(gitlabGroup) || membership[gitlabGroup] < GitlabRoleMapping[mappings.groups[userGroup][gitlabGroup]]) {
            membership[gitlabGroup] = GitlabRoleMapping[mappings.groups[userGroup][gitlabGroup]]
          }
        }
      }
    }
  }

  return membership
}
