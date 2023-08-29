import { GitlabGroup, GitlabApiUser, GitlabAccessUpdate, GitlabMembership, GitlabAccessUpdateOperation } from "./types"
import { Gitlab } from './index';
import { getSecretFromAws } from "../utils/aws";
import fs from 'fs';

const GITLAB_API_TOKEN = await resolveGitlabApiToken()

async function resolveGitlabApiToken(): Promise<string> {
  if (process.env.GITLAB_API_TOKEN_SECRET !== undefined) {
    return await getSecretFromAws(process.env.GITLAB_API_TOKEN_SECRET)
  }

  if (process.env.GITLAB_API_TOKEN_FILE !== undefined) {
    if (fs.existsSync(process.env.GITLAB_API_TOKEN_FILE)) {
      throw Error(`Gitlab API token file does not exist: ${process.env.GITLAB_API_TOKEN_FILE}`)
    }
    return (fs.readFileSync(process.env.GITLAB_API_TOKEN_FILE)).toString()
  }

  if (process.env.GITLAB_API_TOKEN !== undefined) {
    return process.env.GITLAB_API_TOKEN
  }

  throw Error("gitlab api token was not provided.")
}

export class GitlabApi extends Gitlab {
  headers: { "PRIVATE-TOKEN": string }

  constructor() {
    super()

    this.url = `${this.url}/v4/groups`
    this.headers = {
      "PRIVATE-TOKEN": GITLAB_API_TOKEN,
    }
  }

  async listUserMembership(userId: string): Promise<GitlabMembership[]> {
    let membership = await this.request(`/${this.group}/billable_members/${userId}/memberships`, {}, [200, 404]) as GitlabMembership[]

    if (Array.isArray(membership)) {
      membership.forEach(value => { value.source_full_name = value.source_full_name.replaceAll(" ", ""); return value })
    } else {
      membership = []
    }
    return membership
  }

  async listGroups(): Promise<GitlabGroup[]> {
    var page = 1;

    var groups: GitlabGroup[] = []

    while (page !== -1) {
      const resp = await this.rawRequest(`?all_available=true&page=${page}`, {})
      if (resp.headers.get("x-next-page") !== null) {
        page = +resp.headers.get("x-next-page")!
      } else {
        page = -1
      }

      for (var group of (await resp.json()) as GitlabGroup[]) {
        groups.push(group)
      }
    }

    return groups
  }

  async listGroupSamlMembers(groupName?: string): Promise<{ [key: string]: GitlabApiUser }> {
    var page = 1;

    var users: { [key: string]: GitlabApiUser } = {}
    if (groupName === undefined) {
      groupName = this.group
    }

    while (page !== -1) {
      const resp = await this.rawRequest(`/${groupName}/members?page=${page}`, {})
      if (resp.headers.get("x-next-page") !== null) {
        page = +resp.headers.get("x-next-page")!
      } else {
        page = -1
      }

      for (var user of (await resp.json()) as GitlabApiUser[]) {
        if (user.username.startsWith("group_")) {
          continue
        }

        if (user.group_saml_identity !== null && user.group_saml_identity !== undefined) {
          users[user.group_saml_identity.extern_uid] = user
        }
      }
    }

    return users
  }

  async changeUserAccessLevel(change: GitlabAccessUpdate) {
    switch (change.op) {
      case GitlabAccessUpdateOperation.ADD:
        await this.rawRequest(`/${change.group.replace("/", "%2F")}/invitations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: JSON.stringify({
            email: change.user,
            access_level: change.role
          })
        })
        break;
      case GitlabAccessUpdateOperation.REMOVE:
        await this.rawRequest(`/${change.group.replace("/", "%2F")}/members/${change.user}`, {
          method: "DELETE"
        })
        break;
      case GitlabAccessUpdateOperation.UPDATE:
        await this.rawRequest(`/${change.group.replace("/", "%2F")}/members/${change.user}?access_level=${change.role}`, {
          method: "PUT"
        })
        break;
    }
  }
}
