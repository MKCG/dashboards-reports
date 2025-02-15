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
 *
 */
package com.amazon.opendistroforelasticsearch.reportsscheduler

import com.amazon.opendistroforelasticsearch.jobscheduler.spi.JobSchedulerExtension
import com.amazon.opendistroforelasticsearch.jobscheduler.spi.ScheduledJobParser
import com.amazon.opendistroforelasticsearch.jobscheduler.spi.ScheduledJobRunner
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.CreateReportDefinitionAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.DeleteReportDefinitionAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.GetAllReportDefinitionsAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.GetAllReportInstancesAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.GetReportDefinitionAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.GetReportInstanceAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.InContextReportCreateAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.OnDemandReportCreateAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.PollReportInstanceAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.UpdateReportDefinitionAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.action.UpdateReportInstanceStatusAction
import com.amazon.opendistroforelasticsearch.reportsscheduler.index.ReportDefinitionsIndex
import com.amazon.opendistroforelasticsearch.reportsscheduler.index.ReportDefinitionsIndex.REPORT_DEFINITIONS_INDEX_NAME
import com.amazon.opendistroforelasticsearch.reportsscheduler.index.ReportInstancesIndex
import com.amazon.opendistroforelasticsearch.reportsscheduler.resthandler.OnDemandReportRestHandler
import com.amazon.opendistroforelasticsearch.reportsscheduler.resthandler.ReportDefinitionListRestHandler
import com.amazon.opendistroforelasticsearch.reportsscheduler.resthandler.ReportDefinitionRestHandler
import com.amazon.opendistroforelasticsearch.reportsscheduler.resthandler.ReportInstanceListRestHandler
import com.amazon.opendistroforelasticsearch.reportsscheduler.resthandler.ReportInstancePollRestHandler
import com.amazon.opendistroforelasticsearch.reportsscheduler.resthandler.ReportInstanceRestHandler
import com.amazon.opendistroforelasticsearch.reportsscheduler.resthandler.ReportStatsRestHandler
import com.amazon.opendistroforelasticsearch.reportsscheduler.scheduler.ReportDefinitionJobParser
import com.amazon.opendistroforelasticsearch.reportsscheduler.scheduler.ReportDefinitionJobRunner
import com.amazon.opendistroforelasticsearch.reportsscheduler.settings.PluginSettings

import org.opensearch.action.ActionRequest
import org.opensearch.action.ActionResponse
import org.opensearch.client.Client
import org.opensearch.cluster.metadata.IndexNameExpressionResolver
import org.opensearch.cluster.node.DiscoveryNodes
import org.opensearch.cluster.service.ClusterService
import org.opensearch.common.io.stream.NamedWriteableRegistry
import org.opensearch.common.settings.ClusterSettings
import org.opensearch.common.settings.IndexScopedSettings
import org.opensearch.common.settings.Setting
import org.opensearch.common.settings.Settings
import org.opensearch.common.settings.SettingsFilter
import org.opensearch.common.xcontent.NamedXContentRegistry
import org.opensearch.env.Environment
import org.opensearch.env.NodeEnvironment
import org.opensearch.plugins.ActionPlugin
import org.opensearch.plugins.Plugin
import org.opensearch.repositories.RepositoriesService
import org.opensearch.rest.RestController
import org.opensearch.rest.RestHandler
import org.opensearch.script.ScriptService
import org.opensearch.threadpool.ThreadPool
import org.opensearch.watcher.ResourceWatcherService
import java.util.function.Supplier

/**
 * Entry point of the OpenDistro for OpenSearch Reports scheduler plugin.
 * This class initializes the rest handlers.
 */
class ReportsSchedulerPlugin : Plugin(), ActionPlugin, JobSchedulerExtension {

    companion object {
        const val PLUGIN_NAME = "opendistro-reports-scheduler"
        const val LOG_PREFIX = "reports"
        const val BASE_REPORTS_URI = "/_opendistro/_reports"
    }

    /**
     * {@inheritDoc}
     */
    override fun getSettings(): List<Setting<*>> {
        return PluginSettings.getAllSettings()
    }

    /**
     * {@inheritDoc}
     */
    override fun createComponents(
        client: Client,
        clusterService: ClusterService,
        threadPool: ThreadPool,
        resourceWatcherService: ResourceWatcherService,
        scriptService: ScriptService,
        xContentRegistry: NamedXContentRegistry,
        environment: Environment,
        nodeEnvironment: NodeEnvironment,
        namedWriteableRegistry: NamedWriteableRegistry,
        indexNameExpressionResolver: IndexNameExpressionResolver,
        repositoriesServiceSupplier: Supplier<RepositoriesService>
    ): Collection<Any> {
        PluginSettings.addSettingsUpdateConsumer(clusterService)
        ReportDefinitionsIndex.initialize(client, clusterService)
        ReportInstancesIndex.initialize(client, clusterService)
        return emptyList()
    }

    /**
     * {@inheritDoc}
     */
    override fun getJobType(): String {
        return "reports-scheduler"
    }

    /**
     * {@inheritDoc}
     */
    override fun getJobIndex(): String {
        return REPORT_DEFINITIONS_INDEX_NAME
    }

    /**
     * {@inheritDoc}
     */
    override fun getJobRunner(): ScheduledJobRunner {
        return ReportDefinitionJobRunner
    }

    /**
     * {@inheritDoc}
     */
    override fun getJobParser(): ScheduledJobParser {
        return ReportDefinitionJobParser
    }

    /**
     * {@inheritDoc}
     */
    override fun getRestHandlers(
        settings: Settings,
        restController: RestController,
        clusterSettings: ClusterSettings,
        indexScopedSettings: IndexScopedSettings,
        settingsFilter: SettingsFilter,
        indexNameExpressionResolver: IndexNameExpressionResolver,
        nodesInCluster: Supplier<DiscoveryNodes>
    ): List<RestHandler> {
        return listOf(
            ReportDefinitionRestHandler(),
            ReportDefinitionListRestHandler(),
            ReportInstanceRestHandler(),
            ReportInstanceListRestHandler(),
            OnDemandReportRestHandler(),
            ReportInstancePollRestHandler(),
            ReportStatsRestHandler()
        )
    }

    /**
     * {@inheritDoc}
     */
    override fun getActions(): List<ActionPlugin.ActionHandler<out ActionRequest, out ActionResponse>> {
        return listOf(
            ActionPlugin.ActionHandler(CreateReportDefinitionAction.ACTION_TYPE, CreateReportDefinitionAction::class.java),
            ActionPlugin.ActionHandler(DeleteReportDefinitionAction.ACTION_TYPE, DeleteReportDefinitionAction::class.java),
            ActionPlugin.ActionHandler(GetAllReportDefinitionsAction.ACTION_TYPE, GetAllReportDefinitionsAction::class.java),
            ActionPlugin.ActionHandler(GetAllReportInstancesAction.ACTION_TYPE, GetAllReportInstancesAction::class.java),
            ActionPlugin.ActionHandler(GetReportDefinitionAction.ACTION_TYPE, GetReportDefinitionAction::class.java),
            ActionPlugin.ActionHandler(GetReportInstanceAction.ACTION_TYPE, GetReportInstanceAction::class.java),
            ActionPlugin.ActionHandler(InContextReportCreateAction.ACTION_TYPE, InContextReportCreateAction::class.java),
            ActionPlugin.ActionHandler(OnDemandReportCreateAction.ACTION_TYPE, OnDemandReportCreateAction::class.java),
            ActionPlugin.ActionHandler(PollReportInstanceAction.ACTION_TYPE, PollReportInstanceAction::class.java),
            ActionPlugin.ActionHandler(UpdateReportDefinitionAction.ACTION_TYPE, UpdateReportDefinitionAction::class.java),
            ActionPlugin.ActionHandler(UpdateReportInstanceStatusAction.ACTION_TYPE, UpdateReportInstanceStatusAction::class.java)
        )
    }
}
