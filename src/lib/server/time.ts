/**
 * 服务端统一入口。
 *
 * 实现放在 `$lib/time`，与前端共用同一份逻辑；此文件只做 re-export，
 * 让服务端代码统一从 `$lib/server/time` 引入，避免两端实现漂移。
 */
export {
  BIZ_TIME_ZONE,
  todayInBizTZ,
  formatInBizTZ,
  formatDateInBizTZ,
  todayStampInBizTZ,
  addDaysInBizTZ,
} from '$lib/time';
