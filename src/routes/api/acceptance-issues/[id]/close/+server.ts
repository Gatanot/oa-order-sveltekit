import { audit, getDb, isoNow, touch } from '$lib/server/db';
import { randomUUID } from 'node:crypto';
import { stateForAcceptanceIssue } from '$lib/server/workflow';
import { action, body, requiredText } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const data = await body(event);
  return action(() => getDb().transaction(() => {
    const db = getDb();
    const issue = db.prepare('SELECT * FROM acceptance_issues WHERE id=?').get(event.params.id) as { id: string; order_id: string; status: string; resolved_at: string | null; resolved_by: string | null } | undefined;
    if (!issue) throw new Error('ACCEPTANCE_NOT_FOUND');
    const current = stateForAcceptanceIssue(db, issue);
    if (data.verify && current.stage !== '待复验') throw new Error('ACCEPTANCE_VERIFY_STAGE_REQUIRED');
    const changedAt = isoNow();
    const actor = String(data.actor || 'user');
    const resolutionNote = requiredText(data.resolution_note || data.note, 'RESOLUTION_NOTE_REQUIRED');
    const nextStatus = issue.status === '待整改' ? '已整改' : data.verify ? '已验收' : '已整改';
    db.prepare("UPDATE acceptance_issues SET status=?,resolved_at=?,resolved_by=?,verified_at=?,verified_by=?,resolution_note=?,updated_at=?,version=version+1 WHERE id=?").run(nextStatus, nextStatus === '已整改' ? changedAt : issue.resolved_at, nextStatus === '已整改' ? actor : issue.resolved_by, nextStatus === '已验收' ? changedAt : null, nextStatus === '已验收' ? actor : null, resolutionNote, changedAt, issue.id);
    db.prepare('INSERT INTO status_history VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), issue.order_id, 'acceptance_issue', issue.id, issue.status, nextStatus, nextStatus === '已整改' ? '登记整改完成' : '复验通过', actor, resolutionNote, changedAt);
    touch(db, issue.order_id, actor);
    audit(db, issue.order_id, nextStatus === '已整改' ? '验收整改完成' : '验收问题复验通过', actor, { issue_id: issue.id, resolution_note: resolutionNote });
    return { ok: true };
  })());
};
