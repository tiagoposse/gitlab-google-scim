import { GoogleUser } from "../google/types"
import { GitlabScimUser, GitlabScimUsersListResponse, GitlabUserUpdate, GitlabUserUpdateOperation } from "./types"
import { Gitlab } from './index';
import { getSecretFromAws } from "../utils/aws";
import { logger } from "../utils/logging";

const GITLAB_SCIM_TOKEN = await resolveGitlabScimToken()

async function resolveGitlabScimToken(): Promise<string> {

  if (process.env.GITLAB_SCIM_TOKEN_SECRET !== undefined) {
    return await getSecretFromAws(process.env.GITLAB_SCIM_TOKEN_SECRET)
  }

  if (process.env.GITLAB_SCIM_TOKEN_FILE !== undefined) {
    const f = Bun.file(process.env.GITLAB_SCIM_TOKEN_FILE)

    if (!f.exists()) {
      throw Error(`Gitlab SCIM token file does not exist: ${process.env.GITLAB_SCIM_TOKEN_FILE}`)
    }
    return await f.text()
  }

  if (process.env.GITLAB_SCIM_TOKEN !== undefined) {
    return process.env.GITLAB_SCIM_TOKEN
  }

  throw Error("gitlab scim token was not provided.")
}

export class GitlabScim extends Gitlab {
  headers: { Authorization: string, "Content-Type": string }

  constructor() {
    super()

    this.url = `${this.url}/scim/v2/groups/${this.group}/Users`
    this.headers = {
      Authorization: `Bearer ${GITLAB_SCIM_TOKEN}`,
      "Content-Type": "application/scim+json"
    }
  }

  async createUser(user: GoogleUser) {
    console.log(await this.request({
      url: "/",
      method: "POST",
      body: {
        externalId: user.primaryEmail,
        userName: `${user.name.givenName[0]}${user.name.familyName}`,
        active: null,
        name: {
          formatted: user.name.fullName,
          familyName: user.name.familyName,
          givenName: user.name.givenName
        },
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        meta: { resourceType: "User" },
        emails: [
          {
            type: "work",
            value: user.primaryEmail,
            primary: true
          }
        ]
      }
    }))
  }

  async activateUser(user: GitlabScimUser) {
    this.request(
      {
        url: `/${user.id}`,
        method: 'PATCH',
        body: {
          Operations: [
            {
              op: "Update",
              path: "active",
              value: true
            }
          ]
        }
      }
    )
  }

  async removeScimUser(user: GitlabScimUser) {
    this.request(
      {
        url: `/${user.id}`,
        method: 'DELETE'
      }
    )
  }

  async listScimUsers(): Promise<{ [key: string]: GitlabScimUser }> {
    var users: { [key: string]: GitlabScimUser } = {}

    var startIndex = 1
    while (startIndex > -1) {
      const resp = await this.request({ url: "" }) as GitlabScimUsersListResponse

      for (var u of resp.Resources) {
        for (const email of u.emails) {
          if (email.primary) {
            users[email.value] = u
            break
          }
        }
      }

      if (startIndex + resp.itemsPerPage < resp.totalResults) {
        startIndex += resp.itemsPerPage
      } else {
        startIndex = -1
      }
    }

    return users
  }

  async updateUser(change: GitlabUserUpdate) {
    switch (change.op) {
      case GitlabUserUpdateOperation.ADD:
        await this.createUser(change.user as GoogleUser)
        logger.info(`user ${change.user.id} created.`)
        break;
      case GitlabUserUpdateOperation.REMOVE:
        await this.removeScimUser(change.user as GitlabScimUser)
        logger.info(`user ${change.user.id} removed.`)
        break;
      case GitlabUserUpdateOperation.ACTIVATE:
        await this.activateUser(change.user as GitlabScimUser)
        logger.info(`user ${change.user.id} activate.`)
        break;
    }
  }
}
