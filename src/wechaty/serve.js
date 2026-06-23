function lazyServe(loader, exportName) {
  return async (...args) => {
    const module = await loader()
    return module[exportName](...args)
  }
}

/**
 * 获取 AI 服务
 * @param serviceType 服务类型 'deepseek' | 'ChatGPT'
 * @returns {Function}
 */
export function getServe(serviceType) {
  switch (serviceType) {
    case 'ChatGPT':
      return lazyServe(() => import('../openai/index.js'), 'getGptReply')
    case 'deepseek':
      return lazyServe(() => import('../deepseek/index.js'), 'getDeepseekReply')
    default:
      return lazyServe(() => import('../deepseek/index.js'), 'getDeepseekReply')
  }
}
