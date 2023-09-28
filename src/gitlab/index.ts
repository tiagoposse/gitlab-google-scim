import fetch, {
  Request,
  RequestInit,
  Response,
} from 'node-fetch'

export abstract class Gitlab {
  url: string
  group: string
  headers: { [key: string]: string }

  constructor() {
    if (process.env.GITLAB_GROUP === undefined) {
      throw Error("GITLAB_GROUP must be provided")
    }

    this.url = `${process.env.GITLAB_URL || 'https://gitlab.com'}/api`
    this.group = process.env.GITLAB_GROUP!
    this.headers = {}
  }

  async request(url: string, config: RequestInit, accepted?: number[]): Promise<any> {
    if (accepted === undefined) {
      accepted = [201, 204, 200]
    }
    return await (await this.rawRequest(url, config, accepted)).json()
  }

  async rawRequest(suffix: string, config: RequestInit, accepted?: number[]): Promise<Response> {
    if (accepted === undefined) {
      accepted = [201, 204, 200]
    }

    if (config.method === undefined) {
      config.method = "GET"
    }
    if (config.headers === undefined) {
      config.headers = {}
    }

    config.headers = { ...this.headers, ...config.headers }

    const req = new Request(`${this.url}${suffix}`, config)
    const resp = await fetch(req)

    if (!accepted.includes(resp.status)) {
      const message = `Could not execute gitlab request ${config.method} to ${this.url}${suffix} (${resp.status}): ${resp.statusText}`
      if (resp.status === 404) {
        throw new NotFoundError(message)
      } else {
        throw Error(message)
      }
    }

    return resp
  }
}

export class NotFoundError extends Error { }
