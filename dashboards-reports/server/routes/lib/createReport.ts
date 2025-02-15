/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

/*
 * Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import {
  REPORT_TYPE,
  REPORT_STATE,
  DELIVERY_TYPE,
  SECURITY_CONSTANTS,
} from '../utils/constants';

import {
  ILegacyScopedClusterClient,
  OpenSearchDashboardsRequest,
  Logger,
  RequestHandlerContext,
} from '../../../../../src/core/server';
import { createSavedSearchReport } from '../utils/savedSearchReportHelper';
import { ReportSchemaType } from '../../model';
import { CreateReportResultType } from '../utils/types';
import { createVisualReport } from '../utils/visual_report/visualReportHelper';
import { SetCookie, Headers } from 'puppeteer-core';
import { deliverReport } from './deliverReport';
import { updateReportState } from './updateReportState';
import { saveReport } from './saveReport';
import { SemaphoreInterface } from 'async-mutex';
import { AccessInfoType } from 'server';

export const createReport = async (
  request: OpenSearchDashboardsRequest,
  context: RequestHandlerContext,
  report: ReportSchemaType,
  accessInfo: AccessInfoType,
  savedReportId?: string
): Promise<CreateReportResultType> => {
  const isScheduledTask = false;
  //@ts-ignore
  const logger: Logger = context.reporting_plugin.logger;
  //@ts-ignore
  const semaphore: SemaphoreInterface = context.reporting_plugin.semaphore;
  // @ts-ignore
  const notificationClient: ILegacyScopedClusterClient = context.reporting_plugin.notificationClient.asScoped(
    request
  );
  // @ts-ignore
  const opensearchReportsClient: ILegacyScopedClusterClient = context.reporting_plugin.opensearchReportsClient.asScoped(
    request
  );
  const opensearchClient = context.core.opensearch.legacy.client;
  // @ts-ignore
  const timezone = request.query.timezone;
  const {
    basePath,
    serverInfo: { protocol, port, hostname },
  } = accessInfo;

  let createReportResult: CreateReportResultType;
  let reportId;

  const {
    report_definition: {
      report_params: reportParams,
      delivery: { delivery_type: deliveryType },
    },
  } = report;
  const { report_source: reportSource } = reportParams;

  try {
    // create new report instance and set report state to "pending"
    if (savedReportId) {
      reportId = savedReportId;
    } else {
      const opensearchResp = await saveReport(report, opensearchReportsClient);
      reportId = opensearchResp.reportInstance.id;
    }
    // generate report
    if (reportSource === REPORT_TYPE.savedSearch) {
      createReportResult = await createSavedSearchReport(
        report,
        opensearchClient,
        isScheduledTask
      );
    } else {
      // report source can only be one of [saved search, visualization, dashboard]
      // compose url
      const relativeUrl = report.query_url.startsWith(basePath)
        ? report.query_url
        : `${basePath}${report.query_url}`;
      const completeQueryUrl = `${protocol}://${hostname}:${port}${relativeUrl}`;
      // Check if security is enabled. TODO: is there a better way to check?
      let cookieObject: SetCookie | undefined;
      if (request.headers.cookie) {
        const cookies = request.headers.cookie.split(';');
        cookies.map((item: string) => {
          const cookie = item.trim().split('=');
          if (cookie[0] === SECURITY_CONSTANTS.AUTH_COOKIE_NAME) {
            cookieObject = {
              name: cookie[0],
              value: cookie[1],
              url: completeQueryUrl,
              path: basePath,
            };
          }
        });
      }
      // If header exists assuming that it needs forwarding
      let additionalHeaders: Headers | undefined;
      if (request.headers[SECURITY_CONSTANTS.PROXY_AUTH_USER_HEADER]) {
        additionalHeaders = {}
        additionalHeaders[SECURITY_CONSTANTS.PROXY_AUTH_USER_HEADER] = request.headers[SECURITY_CONSTANTS.PROXY_AUTH_USER_HEADER];
        additionalHeaders[SECURITY_CONSTANTS.PROXY_AUTH_IP_HEADER] = request.headers[SECURITY_CONSTANTS.PROXY_AUTH_IP_HEADER];
        if (request.headers[SECURITY_CONSTANTS.PROXY_AUTH_ROLES_HEADER]) {
          additionalHeaders[SECURITY_CONSTANTS.PROXY_AUTH_ROLES_HEADER] = request.headers[SECURITY_CONSTANTS.PROXY_AUTH_ROLES_HEADER]
        }
      }
      const [value, release] = await semaphore.acquire();
      try {
        createReportResult = await createVisualReport(
          reportParams,
          completeQueryUrl,
          logger,
          cookieObject,
          additionalHeaders,
          timezone
        );
      } finally {
        release();
      }
    }
    // update report state to "created"
    // TODO: temporarily remove the following
    // if (!savedReportId) {
    //   await updateReportState(reportId, opensearchReportsClient, REPORT_STATE.created);
    // }

    // deliver report
    if (!savedReportId && deliveryType == DELIVERY_TYPE.channel) {
      await deliverReport(
        report,
        notificationClient,
        opensearchReportsClient,
        reportId,
        logger
      );
    }
  } catch (error) {
    // update report instance with "error" state
    // TODO: save error detail and display on UI
    // TODO: temporarily disable the following, will add back
    // if (!savedReportId) {
    //   await updateReportState(reportId, opensearchReportsClient, REPORT_STATE.error);
    // }
    throw error;
  }

  return createReportResult;
};
