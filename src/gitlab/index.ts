import { logger } from "../utils/logging"
import fetch, {
  Headers,
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

  async rawRequest(url: string, config: RequestInit, accepted?: number[]): Promise<Response> {
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
    // if (config.body !== undefined) {
    //   if ((config.headers as Headers).get("Content-Type") === "application/x-www-form-urlencoded") {
    //     let formBody = []
    //     for (const k of Object.keys(config.body)) {
    //       formBody.push(`${k}=${config.body[k]}`)
    //     }
    //     config.body = formBody.join("&")
    //   } else {
    //     config.body = JSON.stringify(config.body)
    //   }
    // }

    const req = new Request(`${this.url}${url}`, config)
    const resp = await fetch(req)

    if (!accepted.includes(resp.status)) {
      throw Error(`Could not execute gitlab request ${config.method} to ${this.url}${url} (${resp.status}): ${resp.statusText}`)
    }

    return resp
  }
}
