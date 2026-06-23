import { getOpenCliRuntimeConfig } from '../config/env.js'
import { splitCommand, streamCommand } from '../utils/process.js'

export function resolveOpenCliCommand() {
  const config = getOpenCliRuntimeConfig()
  const configured = splitCommand(config.bin)
  if (configured.length) {
    return {
      command: configured[0],
      args: configured.slice(1),
    }
  }

  return {
    command: 'npx',
    args: ['--yes', config.npmPackage],
  }
}

export async function runOpenCli(args = []) {
  const base = resolveOpenCliCommand()
  return streamCommand(base.command, [...base.args, ...args])
}

export async function runWxCli(args = []) {
  return runOpenCli(['wx-cli', ...args])
}
