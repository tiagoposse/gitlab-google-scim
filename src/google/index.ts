
import { GoogleAuth } from 'google-auth-library';
import { GoogleUser, GoogleGroupMember, GoogleGroupsListResponse, GoogleUsersListResponse, GoogleGroup, GoogleGroupMembersListResponse } from './types';
import { minimatch } from 'minimatch';
import { getSecretFromAws } from "../utils/aws";
import fs from 'fs';

const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly'
];
const GOOGLE_SA_KEY_FILE = process.env.GOOGLE_SA_KEY_FILE
const GOOGLE_DOMAIN = process.env.GOOGLE_DOMAIN
const GOOGLE_ADMIN_EMAIL = process.env.GOOGLE_ADMIN_EMAIL
const GOOGLE_TARGET_SA_FILE = GOOGLE_SA_KEY_FILE || "/tmp/service_account.json"

async function resolveGoogleServiceAcccount() {
  if (process.env.GOOGLE_SA_KEY_SECRET !== undefined) {
    const secret = await getSecretFromAws(process.env.GOOGLE_SA_KEY_SECRET)
    fs.writeFileSync(GOOGLE_TARGET_SA_FILE, secret)
    return
  }

  if (process.env.GOOGLE_SA_KEY !== undefined) {
    fs.writeFileSync(GOOGLE_TARGET_SA_FILE, process.env.GOOGLE_SA_KEY)
    return
  }

  if (process.env.GOOGLE_SA_KEY_FILE !== undefined) {
    if (!fs.existsSync(process.env.GOOGLE_SA_KEY_FILE)) {
      throw Error(`Google service account file does not exist: ${process.env.GOOGLE_SA_KEY_FILE}`)
    }
    return
  }

  throw Error(`Google Service Account was not provided`)
}

export class Google {
  private headers: { Authorization: string }
  private url: string

  constructor() {
    if (GOOGLE_DOMAIN === undefined) {
      throw Error("GOOGLE_DOMAIN needs to be provided")
    }
    if (GOOGLE_ADMIN_EMAIL === undefined) {
      throw Error("GOOGLE_ADMIN_EMAIL needs to be provided")
    }

    this.url = 'https://admin.googleapis.com/admin/directory/v1'
    this.headers = { Authorization: "" }
  }

  async initialize() {
    await resolveGoogleServiceAcccount()

    const auth = new GoogleAuth({
      keyFile: GOOGLE_TARGET_SA_FILE,
      scopes: SCOPES,
      clientOptions: {
        subject: GOOGLE_ADMIN_EMAIL
      },
    });

    const client = await auth.getClient();
    const tokenInfo = await client.getAccessToken();
    if (!tokenInfo.token) {
      throw new Error('Authentication failed.');
    }

    this.headers = {
      Authorization: `Bearer ${tokenInfo.token}`,
    };
  }

  private async request(config: { url?: string, body?: any, headers?: { [key: string]: string }, method?: string }) {
    if (config.method === undefined) {
      config.method = "GET"
    }
    if (config.headers === undefined) {
      config.headers = {}
    }

    config.headers = { ...this.headers, ...config.headers }
    if (config.body === undefined) {
      config.body = JSON.stringify(config.body)
    }

    var url = this.url
    if (config.url !== undefined) {
      url = `${url}${config.url}`
      delete config.url
    }

    const res = await fetch(url, config)
    if (res.status !== 200) {
      throw Error(`Could not execute google request ${config.method} to ${url} (${res.status}): ${res.statusText}`)
    }
    return await res.json()
  }

  async listGroupMembers(groupId: string): Promise<GoogleGroupMember[]> {
    const resp = await this.request({ url: `/groups/${groupId}/members?maxResults=200` }) as GoogleGroupMembersListResponse
    const members: GoogleGroupMember[] = []
    if (resp.members !== undefined) { // group is empty
      for (const member of resp.members) {
        if (member.type === "USER") {
          members.push(member)
        }
      }
    }

    return members
  }

  async membershipForAllGroups(groupIds: string[]): Promise<{ [key: string]: GoogleGroupMember[] }> {
    const membership: { [key: string]: GoogleGroupMember[] } = {}
    for (const groupId of groupIds) {
      membership[groupId] = await this.listGroupMembers(groupId)
    }

    return membership
  }

  async listGroups(groupEmails: string[]): Promise<GoogleGroup[]> {
    const groups: GoogleGroup[] = []

    const body = {
      pageToken: ""
    }

    while (body.pageToken !== undefined) {
      const resp = await this.request({ url: `/groups?domain=${GOOGLE_DOMAIN}` }) as GoogleGroupsListResponse
      body.pageToken = resp.nextPageToken

      for (var group of resp.groups) {
        let match = false
        for (var ge of groupEmails) {
          if (minimatch(group.email, ge)) {
            match = true
            break
          }
        }

        if (match) {
          groups.push(group)
        }
      }
    }
    return groups
  }

  async listUsers(filterEmails: string[]): Promise<{ [key: string]: GoogleUser }> {
    const users: { [key: string]: GoogleUser } = {}

    let pageToken = ""

    while (pageToken !== undefined) {
      let url = `/users?domain=${GOOGLE_DOMAIN}&maxResults=200`
      if (pageToken !== "") {
        url = `/users?maxResults=200&pageToken=${pageToken}`
      }

      const resp = await this.request({ url }) as GoogleUsersListResponse
      pageToken = resp.nextPageToken

      for (let user of resp.users) {
        if (!filterEmails.includes(user.primaryEmail)) {
          continue
        }

        users[user.primaryEmail] = user
      }
    }

    return users
  }
}
