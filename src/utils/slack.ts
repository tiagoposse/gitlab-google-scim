import { IncomingWebhook } from '@slack/webhook';
import { GitlabAccessUpdate, GitlabAccessUpdateOperation, GitlabRole, GitlabRoleMapping, GitlabUserUpdate, GitlabUserUpdateOperation } from '../gitlab/types';
import { logger } from './logging';

// Read a url from the environment variables
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export class Slack {
  private webhook: IncomingWebhook;
  private roleMappingsNames: { [key: number]: string }

  constructor() {
    this.webhook = new IncomingWebhook(SLACK_WEBHOOK_URL!);

    const keys = Object.keys(GitlabRoleMapping)
    const values = Object.values(GitlabRoleMapping)
    this.roleMappingsNames = {}
    for (let index = 0; index < keys.length; index++) {
      this.roleMappingsNames[values[index]] = keys[index]
    }
  }

  private computeUserUpdateNotification(changes: GitlabUserUpdate[]): any[] {
    if (changes.length === 0) {
      return []
    }

    const blocks = [
      {
        "type": "divider"
      },
      {
        "type": "header",
        "text": {
          "type": "plain_text",
          "text": "User changes"
        }
      }
    ]

    const addedUsers = []
    const removedUsers = []
    const activatedUsers = []

    for (const change of changes) {
      switch (change.op) {
        case GitlabUserUpdateOperation.ADD:
          addedUsers.push(change.notes)
          break;
        case GitlabUserUpdateOperation.REMOVE:
          removedUsers.push(change.notes)
          break;
        case GitlabUserUpdateOperation.ACTIVATE:
          activatedUsers.push(change.notes)
          break;
      }
    }

    if (addedUsers.length > 0) {
      blocks.push({
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*Added*: ${addedUsers.join(",")}\n`
        }
      })
    }

    if (removedUsers.length > 0) {
      blocks.push({
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*Removed*: ${removedUsers.join(",")}\n`
        }
      })
    }

    if (activatedUsers.length > 0) {
      blocks.push({
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*Activated*: ${activatedUsers.join(",")}\n`
        }
      })
    }

    return blocks
  }

  private computeMembershipUpdateNotification(changes: GitlabAccessUpdate[]): any[] {
    if (changes.length === 0) {
      return []
    }

    const blocks = [
      {
        "type": "divider"
      },
      {
        "type": "header",
        "text": {
          "type": "plain_text",
          "text": "Membership changes"
        }
      }
    ]

    for (const change of changes) {
      switch (change.op) {
        case GitlabAccessUpdateOperation.ADD:
          blocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `*${change.notes}* granted ${this.roleMappingsNames[change.role]} on ${change.group}\n`
            }
          })
          break;
        case GitlabAccessUpdateOperation.REMOVE:
          blocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `*${change.notes}* revoked ${this.roleMappingsNames[change.role]} on ${change.group}\n`
            }
          })
          break;
        case GitlabAccessUpdateOperation.UPDATE:
          blocks.push({
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `*${change.notes}* moved to ${this.roleMappingsNames[change.role]} on ${change.group}\n`
            }
          })
          break;
      }
    }

    return blocks
  }

  async notify(users: GitlabUserUpdate[], memberships: GitlabAccessUpdate[]) {
    if (users.length === 0 && memberships.length === 0) {
      logger.debug("no changes, not slacking")
      return
    }


    await this.webhook.send({
      blocks: [{
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `Changes were done by Gitlab SSO Scim bridge at ${new Date().toDateString()}`
        }
      }].concat(...this.computeUserUpdateNotification(users), ...this.computeMembershipUpdateNotification(memberships))
    })
  }
}
