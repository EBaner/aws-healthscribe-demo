// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useCallback, useMemo, useState } from 'react';

import { useCollection } from '@cloudscape-design/collection-hooks';
import Button from '@cloudscape-design/components/button';
import Pagination from '@cloudscape-design/components/pagination';
import Table from '@cloudscape-design/components/table';

import { GetMedicalScribeJobCommand, MedicalScribeJobSummary, TranscribeClient } from '@aws-sdk/client-transcribe';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useNotificationsContext } from '@/store/notifications';
import { ListHealthScribeJobsProps, listHealthScribeJobs } from '@/utils/HealthScribeApi';

import { TableHeader, TablePreferences } from './ConversationsTableComponents';
import TableEmptyState from './TableEmptyState';
import { columnDefs } from './tableColumnDefs';
import { DEFAULT_PREFERENCES, TablePreferencesDef } from './tablePrefs';
import { useAuthContext } from '@/store/auth';

const transcribeClient = new TranscribeClient({ region: 'us-east-1' });

type MoreHealthScribeJobs = {
    searchFilter?: ListHealthScribeJobsProps;
    NextToken?: string;
};

async function getHealthScribeJob(MedicalScribeJobName: string | undefined) {
    if (!MedicalScribeJobName) {
        throw new Error('MedicalScribeJobName is required');
    }

    const input = { MedicalScribeJobName };
    const command = new GetMedicalScribeJobCommand(input);
    const response = await transcribeClient.send(command);
    return response.MedicalScribeJob;
}


export default function Conversations() {
    const { user } = useAuthContext(); // Retrieve user info
    const loginId = user?.signInDetails?.loginId || 'No username found'; // Extract login ID

    const { addFlashMessage } = useNotificationsContext();
    const [healthScribeJobs, setHealthScribeJobs] = useState<MedicalScribeJobSummary[]>([]); // HealthScribe jobs from API
    const [moreHealthScribeJobs, setMoreHealthScribeJobs] = useState<MoreHealthScribeJobs>({}); // More HealthScribe jobs from API (NextToken returned)
    const [selectedHealthScribeJob, setSelectedHealthScribeJob] = useState<MedicalScribeJobSummary[] | []>([]); // Selected HealthScribe job
    const [tableLoading, setTableLoading] = useState(false); // Loading state for table
    const [preferences, setPreferences] = useLocalStorage<TablePreferencesDef>(
        'Conversation-Table-Preferences',
        DEFAULT_PREFERENCES
    ); // Conversation table preferences

    // Header counter for the number of HealthScribe jobs
    const headerCounterText = `(${healthScribeJobs.length}${Object.keys(moreHealthScribeJobs).length > 0 ? '+' : ''})`;

    // Call Transcribe API to list HealthScribe jobs - optional search filter
    const listHealthScribeJobsWrapper = useCallback(async (searchFilter: ListHealthScribeJobsProps) => {
        setTableLoading(true);
        try {
            // TableHeader may set a Status of 'ALL' - remove this as it's not a valid status
            const processedSearchFilter = { ...searchFilter };
            if (processedSearchFilter.Status === 'ALL') {
                processedSearchFilter.Status = undefined;
            }
            const listHealthScribeJobsRsp = await listHealthScribeJobs(processedSearchFilter);
    
            // Handle undefined MedicalScribeJobSummaries (the service should return an empty array)
            if (typeof listHealthScribeJobsRsp.MedicalScribeJobSummaries === 'undefined') {
                setHealthScribeJobs([]);
                setTableLoading(false);
                return;
            }
    
            const listResults: MedicalScribeJobSummary[] = listHealthScribeJobsRsp.MedicalScribeJobSummaries;
    
            // Fetch detailed job summaries and filter by user's login ID
            const detailedJobSummaries = await Promise.all(
                listResults.map(async (job) => {
                    try {
                        const jobDetails = await getHealthScribeJob(job.MedicalScribeJobName);
                        const userTag = jobDetails?.Tags?.find(tag => tag.Key === 'UserName');
                        return userTag?.Value === loginId ? job : null;
                    } catch (error) {
                        console.error(`Failed to fetch details for job ${job.MedicalScribeJobName}:`, error);
                        return null;
                    }
                })
            );
    
            // Filter out null values
            const filteredResults = detailedJobSummaries.filter((job): job is MedicalScribeJobSummary => job !== null);
    
            // if NextToken is specified, append search results to existing results
            if (processedSearchFilter.NextToken) {
                setHealthScribeJobs((prevHealthScribeJobs) => prevHealthScribeJobs.concat(filteredResults));
            } else {
                setHealthScribeJobs(filteredResults);
            }
    
            // If the research returned NextToken, there are additional jobs. Set moreHealthScribeJobs to enable pagination
            if (listHealthScribeJobsRsp?.NextToken) {
                setMoreHealthScribeJobs({
                    searchFilter: searchFilter,
                    NextToken: listHealthScribeJobsRsp?.NextToken,
                });
            } else {
                setMoreHealthScribeJobs({});
            }
        } catch (e: unknown) {
            setTableLoading(false);
            addFlashMessage({
                id: e?.toString() || 'ListHealthScribeJobs error',
                header: 'Conversations Error',
                content: e?.toString() || 'ListHealthScribeJobs error',
                type: 'error',
            });
        }
        setTableLoading(false);
    }, [addFlashMessage, setTableLoading, setHealthScribeJobs, setMoreHealthScribeJobs]);
    
    

    // Property for <Pagination /> to enable ... on navigation if there are additional HealthScribe jobs
    const openEndPaginationProp = useMemo(() => {
        if (Object.keys(moreHealthScribeJobs).length > 0) {
            return { openEnd: true };
        } else {
            return {};
        }
    }, [moreHealthScribeJobs]);

    // Table collection
    const { items, actions, collectionProps, paginationProps } = useCollection(healthScribeJobs, {
        filtering: {
            empty: <TableEmptyState title="No HealthScribe jobs" subtitle="Try clearing the search filter." />,
            noMatch: (
                <TableEmptyState
                    title="No matches"
                    subtitle="We cannot find a match."
                    action={<Button onClick={() => actions.setFiltering('')}>Clear filter</Button>}
                />
            ),
        },
        pagination: { pageSize: preferences.pageSize },
        sorting: {},
        selection: {},
    });

    return (
        <Table
            {...collectionProps}
            columnDefinitions={columnDefs}
            header={
                <TableHeader
                    selectedHealthScribeJob={selectedHealthScribeJob}
                    headerCounterText={headerCounterText}
                    listHealthScribeJobs={listHealthScribeJobsWrapper}
                />
            }
            items={items}
            loading={tableLoading}
            loadingText="Loading HealthScribe jobs"
            onSelectionChange={({ detail }) => setSelectedHealthScribeJob(detail.selectedItems)}
            pagination={
                <Pagination
                    {...openEndPaginationProp}
                    {...paginationProps}
                    onChange={(event) => {
                        if (event.detail?.currentPageIndex > paginationProps.pagesCount) {
                            listHealthScribeJobsWrapper({
                                ...moreHealthScribeJobs.searchFilter,
                                NextToken: moreHealthScribeJobs.NextToken,
                            }).catch(console.error);
                        }
                        paginationProps.onChange(event);
                    }}
                />
            }
            preferences={<TablePreferences preferences={preferences} setPreferences={setPreferences} />}
            resizableColumns={true}
            selectedItems={selectedHealthScribeJob}
            selectionType="single"
            stickyHeader={true}
            stripedRows={preferences.stripedRows}
            trackBy="MedicalScribeJobName"
            variant="full-page"
            visibleColumns={preferences.visibleContent}
            wrapLines={preferences.wrapLines}
        />
    );
}
