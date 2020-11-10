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
  LOCAL_HOST,
} from '../routes/utils/constants';
import { updateReportState } from '../routes/utils/helpers';
import { ILegacyClusterClient, Logger } from '../../../../src/core/server';
import { createSavedSearchReport } from '../routes/utils/savedSearchReportHelper';
import { ReportSchemaType } from '../model';
import { CreateReportResultType } from '../routes/utils/types';
import { createVisualReport } from '../routes/utils/visualReportHelper';
import { deliverReport } from '../routes/lib/deliverReport';

export const createScheduledReport = async (
  reportId: string,
  report: ReportSchemaType,
  esClient: ILegacyClusterClient,
  esReportsClient: ILegacyClusterClient,
  notificationClient: ILegacyClusterClient,
  logger: Logger
): Promise<CreateReportResultType> => {
  const isScheduledTask = true;
  let createReportResult: CreateReportResultType;

  const {
    report_definition: { report_params: reportParams },
  } = report;
  const { report_source: reportSource } = reportParams;

  // compose url with localhost
  const completeQueryUrl = `${LOCAL_HOST}${report.query_url}`;
  try {
    // generate report
    if (reportSource === REPORT_TYPE.savedSearch) {
      createReportResult = await createSavedSearchReport(
        report,
        esClient,
        isScheduledTask
      );
    } else {
      // report source can only be one of [saved search, visualization, dashboard]
      createReportResult = await createVisualReport(
        reportParams,
        completeQueryUrl,
        logger
      );
    }

    await updateReportState(
      isScheduledTask,
      reportId,
      esReportsClient,
      REPORT_STATE.created
    );

    // deliver report
    createReportResult = await deliverReport(
      report,
      createReportResult,
      notificationClient,
      esReportsClient,
      reportId,
      isScheduledTask,
      logger
    );
  } catch (error) {
    // update report instance with "error" state
    //TODO: save error detail and display on UI
    await updateReportState(
      isScheduledTask,
      reportId,
      esReportsClient,
      REPORT_STATE.error
    );
    throw error;
  }

  return createReportResult;
};