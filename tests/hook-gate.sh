#!/bin/bash
# 验证日常巡检 hook 的关键词门控逻辑
gate() {
  printf '%s' "$1" | grep -qE '巡检|日常维护|日常运维|xunjian' && echo "触发" || echo "静默"
}
echo "巡检            -> $(gate '{"prompt":"巡检"}')"
echo "今天天气怎么样   -> $(gate '{"prompt":"今天天气怎么样"}')"
echo "帮我日常维护一下 -> $(gate '{"prompt":"帮我日常维护一下"}')"
echo "xunjian        -> $(gate '{"prompt":"xunjian"}')"
echo "周末有啥活动     -> $(gate '{"prompt":"周末有啥活动"}')"
