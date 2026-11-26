/**
 * 统一时间工具：前后端共用。
 *
 * 约定：
 * - 数据库存储的时间戳一律是 UTC ISO（created_at / updated_at 等），不做任何改动；
 * - 业务日期（订单日期、垫付日期、导出文件名）和页面展示一律按业务时区计算；
 * - 显式指定 timeZone，不依赖运行环境的 TZ 设置，换机器/换容器结果一致。
 */

/** 业务时区：所有业务日期都按此时区解释。 */
export const BIZ_TIME_ZONE = 'Asia/Shanghai';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BIZ_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BIZ_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // 强制 00–23，避免部分环境在午夜输出 24。
  hourCycle: 'h23',
});

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? '';
}

/** 业务时区的今天，格式 YYYY-MM-DD。 */
export function todayInBizTZ(date: Date = new Date()): string {
  const parts = dateFormatter.formatToParts(date);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** 业务时区的时间，格式 YYYY-MM-DD HH:mm:ss；无效输入返回空字符串。 */
export function formatInBizTZ(value: unknown): string {
  const date = toDate(value);
  if (!date) return '';
  const parts = dateTimeFormatter.formatToParts(date);
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')} ${part(parts, 'hour')}:${part(parts, 'minute')}:${part(parts, 'second')}`;
}

/** 业务时区的日期，格式 YYYY-MM-DD；无效输入返回空字符串。 */
export function formatDateInBizTZ(value: unknown): string {
  const date = toDate(value);
  return date ? todayInBizTZ(date) : '';
}

/** 业务时区的今天，格式 YYYYMMDD，用于导出文件名。 */
export function todayStampInBizTZ(date: Date = new Date()): string {
  return todayInBizTZ(date).replaceAll('-', '');
}

/** 在业务日期（YYYY-MM-DD）上加减天数，跨月/跨年安全。 */
export function addDaysInBizTZ(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate() + Math.trunc(days));
  return value.toISOString().slice(0, 10);
}
