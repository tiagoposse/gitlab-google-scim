import { GoogleUser } from "../google/types"

export type GitlabScimUsersListResponse = {
  startIndex: number
  totalResults: number
  itemsPerPage: number
  Resources: GitlabScimUser[]
}

export type GitlabConfig = {
  token: string;
  endpoint: string;
}

export type GitlabScimUser = {
  id: string
  active: boolean,
  userName: string
  emails: { type: string, value: string, primary: boolean }[]
}

export type GitlabApiUser = {
  id: string
  username: string,
  state: string,
  group_saml_identity: {
    extern_uid: string
    provider: string
    saml_provider_id: number
  } | null
}

export type GitlabGroup = {
  id: number
  name: string
  path: string
}

export const GitlabRoleMapping: { [key: string]: GitlabRole } = {
  "No Access": 0,
  "Minimal Access": 5,
  "Guest": 10,
  "Reporter": 20,
  "Developer": 30,
  "Maintainer": 40,
  "Owner": 50
}

export enum GitlabRole {
  NoAccess = 0,
  MinimalAccess = 5,
  Guest = 10,
  Reporter = 20,
  Developer = 30,
  Maintainer = 40,
  Owner = 50
}

export type GitlabMembership = {
  source_id: string
  source_full_name: string
  access_level: {
    integer_value: number
  }
}

export enum GitlabAccessUpdateOperation {
  ADD = "add",
  REMOVE = "remove",
  UPDATE = "update"
}

export type GitlabAccessUpdate = {
  user: string
  group: string
  role: GitlabRole
  op: GitlabAccessUpdateOperation
  notes: string
}

export enum GitlabUserUpdateOperation {
  ADD = "add",
  REMOVE = "remove",
  ACTIVATE = "activate"
}

export type GitlabUserUpdate = {
  user: GoogleUser | GitlabScimUser
  op: GitlabUserUpdateOperation
  notes?: string
}

export enum GitlabPathType {
  GROUP = "group",
  PROJECT = "project"
}
