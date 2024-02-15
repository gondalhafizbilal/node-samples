import { client as redis } from '../../utils/redis';
import { getLogger } from '../../utils/logging';
import { metricsClient } from '../../metrics/metricsClient';

import { GoogleCalendarMetricNames } from './googleCalendar/MetricNames';

import { editTeamCalendarSync } from './googleCalendar/editTeamCalendarSync';
import { addNewToken } from './googleCalendar/addNewToken';
import { removeToken } from './googleCalendar/removeToken';
import { dissociateTeamAndCalendar } from './googleCalendar/dissociateTeamAndCalendar';
import { getAuthedEmails } from './googleCalendar/getAuthedEmails';
import { createCalendar } from './googleCalendar/createCalendar';
import { getUserCalendars } from './googleCalendar/getUserCalendars';
import { associateTeamWithCalendar } from './googleCalendar/associateTeamWithCalendar';
import { getGoogleCalendarEvents } from './googleCalendar/getGoogleCalendarEvents';
import { handlePushNotificationRequest } from './googleCalendar/handlePushNotificationRequest';
import { deleteCalendarSyncsForAccount } from './googleCalendar/deleteCalendarSyncsForAccount';
import { getSyncedCalendars } from './googleCalendar/getSyncedCalendars';
import { editEvent } from './googleCalendar/editEvent';
import { taskUpdatedQueue } from './googleCalendar/queues';

const logger = getLogger('google_calendar');

export function authorizeReq(req, resp) {
    const userid = req.decoded_token.user;
    const { code, redirect_uri } = req.body;

    addNewToken(userid, code, redirect_uri, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function removeTokenReq(req, resp) {
    const userid = req.decoded_token.user;
    const { email } = req.body;

    removeToken(userid, { email }, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function getAuthedEmailsReq(req, resp) {
    const userid = req.decoded_token.user;

    getAuthedEmails(userid, {}, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function createCalendarReq(req, resp) {
    const userid = req.decoded_token.user;
    const { email, summary } = req.body;

    createCalendar(userid, { email, summary }, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function getCalendarsReq(req, resp) {
    const userid = req.decoded_token.user;
    const { email } = req.query;

    getUserCalendars(userid, { email }, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function getSyncedCalendarsReq(req, resp) {
    const userid = req.decoded_token.user;

    getSyncedCalendars(userid, {}, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function associateTeamWithCalendarReq(req, resp) {
    const userid = req.decoded_token.user;
    const { calendar_id, team_id } = req.body;
    const options = req.body;

    associateTeamWithCalendar(userid, team_id, calendar_id, options, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function queueSyncRemovalReq(req, resp) {
    resp.status(200).send({});

    const { sync_id } = req.body;

    redis.sadd('GCAL:syncs_to_remove', sync_id, err => {
        if (err) {
            logger.error({ msg: 'Failed to push onto gcal remval queue', err });
        }
    });
}

export function dissociateTeamAndCalendarReq(req, resp) {
    const userid = req.decoded_token.user;
    const { sync_id } = req.params;

    dissociateTeamAndCalendar(userid, sync_id, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function deleteCalendarSyncsForAccountReq(req, resp) {
    const userid = req.decoded_token.user;
    const { email } = req.query;

    deleteCalendarSyncsForAccount(userid, email, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export function editTeamCalendarSyncReq(req, resp) {
    const userid = req.decoded_token.user;
    const { sync_id } = req.params;
    const options = req.body;

    editTeamCalendarSync(userid, sync_id, options, (err, result) => {
        if (err) {
            resp.status(err.status).send({ err: err.err, ECODE: err.ECODE });
        } else {
            resp.status(200).send(result);
        }
    });
}

export async function queueTaskUpdateReq(req, resp) {
    const { task_id, notification_type, timestamp } = req.body;

    if (!task_id) {
        logger.warn({
            msg: 'Failed to queue task update request because task_id was falsy',
            task_id,
            notification_type,
        });
        resp.status(400).send();
        return;
    }

    metricsClient.increment(GoogleCalendarMetricNames.QUEUE_TASK_UPDATE, 1, { notification_type });

    try {
        if (process.env.USE_LEGACY_TASK_UPDATER !== 'true') {
            await taskUpdatedQueue.add(
                'task updated notification',
                { task_id, notification_type },
                {
                    jobId: task_id,
                    notification_type,
                }
            );
        } else {
            redis.sadd('GCAL:tasks_updated', task_id, err => {
                if (err) {
                    logger.error({ msg: 'Failed to push onto gcal queue', err });
                }
            });
        }
        resp.status(204).send();
    } catch (err) {
        metricsClient.increment(GoogleCalendarMetricNames.QUEUE_TASK_UPDATE_ERROR, 1, { notification_type });
        logger.error({
            msg: 'Failed to queue task update',
            task_id,
            notification_type,
            err,
        });
        resp.status(500).send();
    }
}

export async function queueTaskUpdatesReq(req, resp) {
    const { task_ids } = req.body;
    const notification_type = 'generic_task_update';
    for (const task_id of task_ids) {
        metricsClient.increment(GoogleCalendarMetricNames.QUEUE_TASK_UPDATE, 1, { notification_type });
        if (process.env.USE_LEGACY_TASK_UPDATER !== 'true') {
            await taskUpdatedQueue.add(
                'task updated notification',
                { task_id, notification_type },
                {
                    jobId: task_id,
                    notification_type,
                }
            );
        } else {
            redis.sadd('GCAL:tasks_updated', task_id, err => {
                if (err) {
                    logger.error({ msg: 'Failed to push onto gcal queue', err });
                }
            });
        }
    }

    resp.status(200).send({});
}

export function editGcalEventReq(req, resp, next) {
    const userid = req.decoded_token.user;
    const { sync_id, event_id } = req.params;
    const resource = req.body;

    editEvent(userid, sync_id, event_id, resource, (err, result) => {
        if (err) {
            next(err);
        } else {
            resp.status(200).send(result);
        }
    });
}

export function eventHookReq(req, resp) {
    resp.status(200).send({});
    handlePushNotificationRequest(req.headers);
}

export async function getCalendarEventsReq(req, resp, next) {
    const userid = req.decoded_token.user;
    const options = req.query;
    const { team_id } = req.params;

    try {
        const result = await getGoogleCalendarEvents(userid, team_id, options);
        resp.status(200).send(result);
    } catch (e) {
        next(e);
    }
}
