import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useCollection } from '@cloudscape-design/collection-hooks';
import Button from '@cloudscape-design/components/button';
import Pagination from '@cloudscape-design/components/pagination';
import Table from '@cloudscape-design/components/table';

import { GetMedicalScribeJobCommand, MedicalScribeJobSummary, TranscribeClient } from '@aws-sdk/client-transcribe';
import { fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthContext } from '@/store/auth';
import { useNotificationsContext } from '@/store/notifications';
import { ListHealthScribeJobsProps, listHealthScribeJobs } from '@/utils/HealthScribeApi';
import { getConfigRegion, getCredentials } from '@/utils/Sdk';

import { TableHeader, TablePreferences } from './ConversationsTableComponents';
import TableEmptyState from './TableEmptyState';
import { columnDefs } from './tableColumnDefs';
import { DEFAULT_PREFERENCES, TablePreferencesDef } from './tablePrefs';

async function getTranscribeClient() {
    const credentials = await getCredentials();
    return new TranscribeClient({
        region: getConfigRegion(),
        credentials,
    });
}

async function getUserAttributes(username: string): Promise<string | null> {
    try {
        const user = await getCurrentUser();
        const attributes = await fetchUserAttributes();
        const clinicAttribute = attributes['custom:Clinic'];
        return clinicAttribute || null;
    } catch (error) {
        console.error('Error fetching user attributes: ', error);
        throw error;
    }
}

const transcribeClient = getTranscribeClient();

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
    const client = await transcribeClient; // Await the Promise
    const response = await client.send(command); // Call send on the resolved instance
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
    const [showFiltered, setShowFiltered] = useState<boolean>(true);
    const [clinicName, setClinicName] = useState<string | null>(null); // Store clinic name

    // Header counter for the number of HealthScribe jobs
    const headerCounterText = `(${healthScribeJobs.length}${Object.keys(moreHealthScribeJobs).length > 0 ? '+' : ''})`;

    // Fetch user attributes to get clinic name
    useEffect(() => {
        async function fetchClinic() {
            const clinic = await getUserAttributes(loginId);
            setClinicName(clinic);
        }
        fetchClinic();
    }, [loginId]);

    // Call Transcribe API to list HealthScribe jobs - optional search filter
    const listHealthScribeJobsWrapper = useCallback(
        async (searchFilter: ListHealthScribeJobsProps) => {
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
                    console.log('No MedicalScribeJobSummaries returned');
                    setHealthScribeJobs([]);
                    setTableLoading(false);
                    return;
                }

                const listResults: MedicalScribeJobSummary[] = listHealthScribeJobsRsp.MedicalScribeJobSummaries;
                console.log('List results from API:', listResults);

                if (showFiltered) {
                    // Fetch detailed job summaries and filter by user's login ID or clinic name
                    const detailedJobSummaries = await Promise.all(
                        listResults.map(async (job) => {
                            try {
                                const jobDetails = await getHealthScribeJob(job.MedicalScribeJobName);
                                const userTag = jobDetails?.Tags?.find((tag) => tag.Key === 'UserName');
                                const clinicTag = jobDetails?.Tags?.find((tag) => tag.Key === 'Clinic');
                                const isUserJob = userTag?.Value === loginId;
                                //const isClinicJob = clinicTag?.Value === clinicName;
                                console.log(
                                    `Job: ${job.MedicalScribeJobName}, UserTag: ${userTag?.Value}, ClinicTag: ${clinicTag?.Value}, IsUserJob: ${isUserJob}`
                                );
                                return isUserJob ? job : null;
                            } catch (error) {
                                console.error(`Failed to fetch details for job ${job.MedicalScribeJobName}:`, error);
                                return null;
                            }
                        })
                    );

                    // Filter out null values
                    const filteredResults = detailedJobSummaries.filter(
                        (job): job is MedicalScribeJobSummary => job !== null
                    );

                    console.log('Filtered results:', filteredResults);

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
                } else {
                    const detailedJobSummaries = await Promise.all(
                        listResults.map(async (job) => {
                            try {
                                const jobDetails = await getHealthScribeJob(job.MedicalScribeJobName);
                                const userTag = jobDetails?.Tags?.find((tag) => tag.Key === 'UserName');
                                const clinicTag = jobDetails?.Tags?.find((tag) => tag.Key === 'Clinic');

                                const isClinicJob = clinicTag?.Value === clinicName;
                                const isUserJob = userTag?.Value === loginId;
                                console.log(
                                    `Job: ${job.MedicalScribeJobName}, UserTag: ${userTag?.Value}, ClinicTag: ${clinicTag?.Value}, IsClinicJob: ${isClinicJob}`
                                );
                                return isClinicJob || isUserJob ? job : null;
                            } catch (error) {
                                console.error(`Failed to fetch details for job ${job.MedicalScribeJobName}:`, error);
                                return null;
                            }
                        })
                    );

                    // Filter out null values
                    const filteredResults = detailedJobSummaries.filter(
                        (job): job is MedicalScribeJobSummary => job !== null
                    );

                    console.log('Filtered results:', filteredResults);

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
        },
        [
            addFlashMessage,
            setTableLoading,
            setHealthScribeJobs,
            setMoreHealthScribeJobs,
            showFiltered,
            loginId,
            clinicName,
        ]
    );

    // Automatically refresh the table when the filter is changed
    useEffect(() => {
        listHealthScribeJobsWrapper({}); // Fetch all jobs on component mount and when filter changes
    }, [showFiltered]);

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
        <>
            <Table
                {...collectionProps}
                columnDefinitions={columnDefs}
                header={
                    <TableHeader
                        selectedHealthScribeJob={selectedHealthScribeJob}
                        headerCounterText={headerCounterText}
                        listHealthScribeJobs={listHealthScribeJobsWrapper}
                        showFiltered={showFiltered}
                        setShowFiltered={setShowFiltered}
                    />
                }
                items={healthScribeJobs}
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
        </>
    );
}
