# Gitlab to Google SCIM

Synchronizes your google users with gitlab users via SCIM. It supports mapping of different privileges for different groups & users.


## Configuration

You need a few items of configuration. One side from Gitlab, and the other from Google Cloud to allow for API access to each.
You will need the files produced by these steps for AWS Lambda deployment as well as locally running the sync tool.
This how-to assumes you have Gitlab SSO configured and a Google SAML app to log in into Gitlab.

### Google

First, you have to setup your API. In the project you want to use go to the Console and select API & Services > Enable APIs and Services. Search for Admin SDK and Enable the API.

You have to perform this [tutorial](https://developers.google.com/admin-sdk/directory/v1/guides/delegation) to create a service account that you use to sync your users. Save the JSON file you create during the process. Please, keep this file safe, or store it in the AWS Secrets Manager.

In the domain-wide delegation for the Admin API, you have to specify the following scopes for the user.

https://www.googleapis.com/auth/admin.directory.group.readonly
https://www.googleapis.com/auth/admin.directory.group.member.readonly
https://www.googleapis.com/auth/admin.directory.user.readonly

Back in the Console go to the Dashboard for the API & Services and select "Enable API and Services". In the Search box type Admin and select the Admin SDK option. Click the Enable button.

You will have to specify the email address of an admin via the environment variable GOOGLE_ADMIN_EMAIL to assume this users role in the Directory.


### Slack

To create a slack app and an incoming webhook, follow [this page](https://api.slack.com/messaging/webhooks)


### Gitlab

You need two different credentials, a SCIM token and an API token with `api` access to the root group.

To get a SCIM token:

- Open Gitlab, on the left sidebar, at the top, select Search GitLab () to find your group.
- Select Settings > SAML SSO. Select Generate a SCIM token.
- Save the Token from the Your SCIM token field. Please, keep this token safe, or store it in the AWS Secrets Manager.
- The SCIM API endpoint URL field will be automatically calculated.

To get an API token, [create a Group Access Token](https://docs.gitlab.com/ee/user/group/settings/group_access_tokens.html#create-a-group-access-token-using-ui) or a [Personal Access Token](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html#create-a-personal-access-token).


# Deployment configuration

| Name | Required | Description |
|---|---|---|
| GOOGLE_DOMAIN | yes | google domain that is allowed in gitlab |
| GOOGLE_ADMIN_EMAIL | yes | email of a google administrator that will be impersonated by the service account |
| GOOGLE_SA_KEY_SECRET | no | AWS Secret name to retrieve the service account key from |
| GOOGLE_SA_KEY_FILE | no | Filepath to retrieve the service account key from |
| GOOGLE_SA_KEY | no | Service account key |
| GITLAB_GROUP | yes | gitlab root group to sync users to |
| GITLAB_URL | no | gitlab instance base url, defaults to https://gitlab.com |
| GITLAB_SCIM_TOKEN_SECRET | no | AWS Secret name to retrieve the SCIM token from |
| GITLAB_SCIM_TOKEN_FILE | no | Filepath to retrieve the SCIM token from |
| GITLAB_SCIM_TOKEN | no | SCIM token |
| GITLAB_API_TOKEN_SECRET | no | AWS Secret name to retrieve the API token from |
| GITLAB_API_TOKEN_FILE | no | Filepath to retrieve the API token from |
| GITLAB_API_TOKEN | no | API token |
| DEFAULT_MEMBERSHIP_ROLE | no | Default gitlab role. Defaults to Minimal Access |
| ROLE_MAPPINGS_SECRET | no | AWS Secret name to retrieve the gitlab role mappings from |
| ROLE_MAPPINGS_FILE | no | Filepath to retrieve the gitlab role mappings from |
| ROLE_MAPPINGS | no | Role mappings for gitlab |
| SLACK_WEBHOOK_URL | no | Slack Webhook url to send notifications to |
| LOG_LEVEL | no | Level of logs to print. Defaults to info |
| DRY_RUN | no | Whether to only retrieve information, not create anything. Defaults to false |

# Development

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```
