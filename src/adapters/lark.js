import { getLarkRuntimeConfig } from '../config/env.js'
import { runCommand, streamCommand } from '../utils/process.js'

function getLarkBin() {
  return getLarkRuntimeConfig().bin
}

export async function larkLogin(options = {}) {
  const args = ['auth', 'login']

  if (options.deviceCode) {
    args.push('--device-code', options.deviceCode)
  } else if (options.scope) {
    args.push('--scope', options.scope)
  } else {
    args.push('--domain', options.domain || 'im')
  }

  if (options.noWait || options.wait === false) {
    args.push('--no-wait', '--json')
  }

  return streamCommand(getLarkBin(), args)
}

export async function larkStatus() {
  return streamCommand(getLarkBin(), ['auth', 'status'])
}

export async function larkSendText(options = {}) {
  const identity = options.as || getLarkRuntimeConfig().defaultIdentity
  const args = ['im', '+messages-send', '--as', identity, '--text', options.text || '']

  if (options.chatId) {
    args.push('--chat-id', options.chatId)
  } else if (options.userId) {
    args.push('--user-id', options.userId)
  } else {
    throw new Error('larkSendText requires chatId or userId')
  }

  return streamCommand(getLarkBin(), args)
}

export async function larkListMessages(options = {}) {
  const identity = options.as || getLarkRuntimeConfig().defaultIdentity
  const args = ['im', '+chat-messages-list', '--as', identity, '--format', options.format || 'pretty']

  if (options.chatId) {
    args.push('--chat-id', options.chatId)
  } else if (options.userId) {
    args.push('--user-id', options.userId)
  } else {
    throw new Error('larkListMessages requires chatId or userId')
  }

  if (options.start) args.push('--start', options.start)
  if (options.end) args.push('--end', options.end)
  if (options.pageSize) args.push('--page-size', String(options.pageSize))

  return streamCommand(getLarkBin(), args)
}

export async function larkSearchMessages(options = {}) {
  const args = ['im', '+messages-search', '--as', 'user', '--format', options.format || 'pretty']
  if (options.query) args.push('--query', options.query)
  if (options.chatId) args.push('--chat-id', options.chatId)
  if (options.chatType) args.push('--chat-type', options.chatType)
  if (options.start) args.push('--start', options.start)
  if (options.end) args.push('--end', options.end)
  if (options.pageAll) args.push('--page-all')
  if (options.pageLimit) args.push('--page-limit', String(options.pageLimit))

  return streamCommand(getLarkBin(), args)
}

export async function larkCheckImAuth() {
  return runCommand(getLarkBin(), ['auth', 'check', '--domain', 'im'], { echo: true })
}
