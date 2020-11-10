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

import { ILegacyClusterClient, Logger } from '../../../../src/core/server';
import { createScheduledReport } from './createScheduledReport';
import { POLL_INTERVAL } from '../utils/constants';
import { parseEsErrorResponse } from '../routes/utils/helpers';
import { backendToUiReport } from '../routes/utils/converters/backendToUi';
import { BackendReportInstanceType } from 'server/model/backendModel';

async function pollAndExecuteJob(
  esReportsClient: ILegacyClusterClient,
  notificationClient: ILegacyClusterClient,
  esClient: ILegacyClusterClient,
  logger: Logger
) {
  logger.info(
    `start polling at time: ${new Date().toISOString()} with fixed interval: ${POLL_INTERVAL} milliseconds`
  );
  try {
    // poll job
    const esResp = await esReportsClient.callAsInternalUser(
      'es_reports.pollReportInstance'
    );
    const job: BackendReportInstanceType = esResp.reportInstance;

    // job retrieved, otherwise will be undefined because 204 No-content is returned
    if (job) {
      const reportMetadata = backendToUiReport(job);
      const reportId = job.id;
      logger.info(
        `scheduled job sent from scheduler with report id: ${reportId}`
      );

      const reportData = await createScheduledReport(
        reportId,
        reportMetadata,
        esClient,
        esReportsClient,
        notificationClient,
        logger
      );
      logger.info('done executing job');
    } else {
      // 204 no content is returned, 204 doesn't have response body
      logger.info(`no available job in queue ${JSON.stringify(esResp)}`);
    }
  } catch (error) {
    // TODO: need better error handling
    if (error.statusCode === 404) {
      logger.info(`${error.statusCode} ${parseEsErrorResponse(error)}`);
    } else {
      // for reports-scheduler getJob API and updateJobStatus API error
      logger.error(`${error.statusCode} ${parseEsErrorResponse(error)}`);
    }
  }
}

export { pollAndExecuteJob };