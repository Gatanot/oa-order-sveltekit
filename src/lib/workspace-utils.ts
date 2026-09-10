export function money(value: number | undefined) {
  return `¥${(Number(value ?? 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function date(value: string | undefined) {
  return value ? value.slice(0, 10) : '—';
}

export function stageProgress(stage = '') {
  return ({ 报价中: 20, 执行中: 48, 待复验: 68, 已验收: 100 }[stage] ?? 10);
}

export function stageTone(stage: string) {
  return stage === '已验收' ? 'green' : stage === '执行中' ? 'blue' : 'orange';
}

export function overdue(value: string | undefined) {
  return Boolean(value && value < new Date().toISOString().slice(0, 10));
}
