
export type GoogleGroup = {
  id: string
  name: string
  email: string
}

export type GoogleGroupMember = {
  email: string
  id: string
  status: string
  type: string
}

export type GoogleGroupsListResponse = {
  groups: GoogleGroup[]
  nextPageToken: string
}

export type GoogleUsersListResponse = {
  users: GoogleUser[]
  nextPageToken: string
}

export type GoogleGroupMembersListResponse = {
  members: GoogleGroupMember[]
  nextPageToken: string
}

export type GoogleUser = {
  primaryEmail: string
  id: string
  status: string
  suspended: boolean
  name: {
    fullName: string
    familyName: string
    givenName: string
    displayName: string
  }
}
