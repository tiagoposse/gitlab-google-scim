import { GitlabGroup, GitlabApiUser, GitlabAccessUpdate, GitlabMembership, GitlabAccessUpdateOperation, GitlabPathType } from "./types"
import { Gitlab, NotFoundError } from './index';
import { getSecretFromAws } from "../utils/aws";
import { FormData } from "node-fetch";
import fs from 'fs';

const GITLAB_API_TOKEN = await resolveGitlabApiToken()

async function resolveGitlabApiToken(): Promise<string> {
  if (process.env.GITLAB_API_TOKEN_SECRET !== undefined) {
    return await getSecretFromAws(process.env.GITLAB_API_TOKEN_SECRET)
  }

  if (process.env.GITLAB_API_TOKEN_FILE !== undefined) {
    if (!fs.existsSync(process.env.GITLAB_API_TOKEN_FILE)) {
      throw Error(`Gitlab API token file does not exist: ${process.env.GITLAB_API_TOKEN_FILE}`)
    }
    return (fs.readFileSync(process.env.GITLAB_API_TOKEN_FILE)).toString().trim()
  }

  if (process.env.GITLAB_API_TOKEN !== undefined) {
    return process.env.GITLAB_API_TOKEN
  }

  throw Error("gitlab api token was not provided.")
}



export class GitlabApi extends Gitlab {
  headers: { "PRIVATE-TOKEN": string }
  groupOrProjects: { [key: string]: GitlabPathType }

  constructor() {
    super()

    this.url = `${this.url}/v4`
    this.headers = {
      "PRIVATE-TOKEN": GITLAB_API_TOKEN,
    }
    this.groupOrProjects = {}
  }

  async listUserMembership(userId: string): Promise<GitlabMembership[]> {
    let membership = await this.request(`/groups/${this.group}/billable_members/${userId}/memberships`, {}, [200, 404]) as GitlabMembership[]

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
      const resp = await this.rawRequest(`/groups/${groupName}/members?page=${page}`, {})
      if (resp.headers.get("x-next-page") !== null && resp.headers.get("x-next-page") !== undefined && resp.headers.get("x-next-page") !== "") {
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
    if (this.groupOrProjects[change.group] === undefined) {
      try {
        await this.rawRequest(`/groups/${change.group.replaceAll("/", "%2F")}`, {})
        this.groupOrProjects[change.group] = GitlabPathType.GROUP
      } catch (e) {
        if (e instanceof NotFoundError) {
          this.groupOrProjects[change.group] = GitlabPathType.PROJECT
        } else {
          throw e
        }
      }
    }

    let pathPrefix = ""
    switch (this.groupOrProjects[change.group]) {
      case GitlabPathType.PROJECT:
        pathPrefix = "projects"
        break;
      case GitlabPathType.GROUP:
        pathPrefix = "groups"
        break;
    }

    console.log(`/${pathPrefix}/${change.group.replaceAll("/", "%2F")}/invitations`)
    switch (change.op) {
      case GitlabAccessUpdateOperation.ADD:
        const form = new FormData();
        form.set("email", change.user)
        form.set("access_level", change.role.toString())

        await this.rawRequest(`/${pathPrefix}/${change.group.replaceAll("/", "%2F")}/invitations`, {
          method: "POST",
          body: form
        })
        break;
      case GitlabAccessUpdateOperation.REMOVE:
        await this.rawRequest(`/${pathPrefix}/${change.group.replaceAll("/", "%2F")}/members/${change.user}`, {
          method: "DELETE"
        })
        break;
      case GitlabAccessUpdateOperation.UPDATE:
        await this.rawRequest(`/${pathPrefix}/${change.group.replaceAll("/", "%2F")}/members/${change.user}?access_level=${change.role}`, {
          method: "PUT"
        })
        break;
    }
  }
}
