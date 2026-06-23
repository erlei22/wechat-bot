import { spawn } from 'child_process'

export function splitCommand(command) {
  if (!command) return []
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^["']|["']$/g, '')) || []
}

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
        if (options.echo) process.stdout.write(chunk)
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
        if (options.echo) process.stderr.write(chunk)
      })
    }

    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

export async function streamCommand(command, args = [], options = {}) {
  const result = await runCommand(command, args, {
    ...options,
    stdio: options.stdio || 'inherit',
  })

  if (result.code !== 0) {
    const error = new Error(`${command} exited with code ${result.code}`)
    error.result = result
    throw error
  }

  return result
}
