import { GitlabRoleMapping } from '../gitlab/types';
import { load } from "js-yaml";
import { getSecretFromAws } from './aws';

async function resolveMappings(): Promise<string> {
  if (process.env.ROLE_MAPPINGS_SECRET !== undefined) {
    return await getSecretFromAws(process.env.ROLE_MAPPINGS_SECRET)
  }

  if (process.env.ROLE_MAPPINGS_FILE !== undefined) {
    return await Bun.file(process.env.ROLE_MAPPINGS_FILE).text()
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

  return mappings
}
