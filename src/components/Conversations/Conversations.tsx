import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Button from '@cloudscape-design/components/button';
import Pagination from '@cloudscape-design/components/pagination';
import Table from '@cloudscape-design/components/table';
import { fetchUserAttributes, getCurrentUser } from '@aws-amplify/auth';
import { GetMedicalScribeJobCommand, MedicalScribeJobSummary, TranscribeClient } from '@aws-sdk/client-transcribe';
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
    const client = await transcribeClient;
    const response = await client.send(command);
    return response.MedicalScribeJob;
}

export default function Conversations() {
    const { user } = useAuthContext();
    const loginId = user?.signInDetails?.loginId || 'No username found';
    const { addFlashMessage } = useNotificationsContext();
    const [healthScribeJobs, setHealthScribeJobs] = useState<MedicalScribeJobSummary[]>([]);
    const [moreHealthScribeJobs, setMoreHealthScribeJobs] = useState<MoreHealthScribeJobs>({});
    const [selectedHealthScribeJob, setSelectedHealthScribeJob] = useState<MedicalScribeJobSummary[]>([]);
    const [tableLoading, setTableLoading] = useState(false);
    const [preferences, setPreferences] = useLocalStorage<TablePreferencesDef>('Conversation-Table-Preferences', DEFAULT_PREFERENCES);
    const [showFiltered, setShowFiltered] = useState<boolean>(true);
    const [filterBy, setFilterBy] = useState<'UserName' | 'ClinicName'>('UserName');
    const [clinicName, setClinicName] = useState<string | null>(null);
    const [includeClinicFilter, setIncludeClinicFilter] = useState<boolean>(false);

    async function getUserAttributes(username: string) {
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

    useEffect(() => {
        const fetchClinicName = async () => {
            try {
                const clinic = await getUserAttributes(user?.username || '');
                setClinicName(clinic);
            } catch (error) {
                console.error('Error fetching clinic name: ', error);
            }
        };
        if (user) {
            fetchClinicName();
        }
    }, [user]);

    const headerCounterText = `(${healthScribeJobs.length}${Object.keys(moreHealthScribeJobs).length > 0 ? '+' : ''})`;

    const listHealthScribeJobsWrapper = useCallback(
        async (searchFilter: ListHealthScribeJobsProps) => {
            setTableLoading(true);
            try {
                const processedSearchFilter = { ...searchFilter };
                if (processedSearchFilter.Status === 'ALL') {
                    processedSearchFilter.Status = undefined;
                }
                const listHealthScribeJobsRsp = await listHealthScribeJobs(processedSearchFilter);

                if (typeof listHealthScribeJobsRsp.MedicalScribeJobSummaries === 'undefined') {
                    console.log('No MedicalScribeJobSummaries returned');
                    setHealthScribeJobs([]);
                    setTableLoading(false);
                    return;
                }

                const listResults: MedicalScribeJobSummary[] = listHealthScribeJobsRsp.MedicalScribeJobSummaries;

                const detailedJobSummaries = await Promise.all(
                    listResults.map(async (job) => {
                        try {
                            const jobDetails = await getHealthScribeJob(job.MedicalScribeJobName);
                            let isUserJob = false;

                            if (filterBy === 'UserName') {
                                const userTag = jobDetails?.Tags?.find((tag) => tag.Key === 'UserName');
                                isUserJob = userTag?.Value === loginId;
                            } else if (filterBy === 'ClinicName') {
                                const clinicTag = jobDetails?.Tags?.find((tag) => tag.Key === 'ClinicName');
                                isUserJob = clinicTag?.Value === clinicName;
                            }

                            console.log(
                                `Job: ${job.MedicalScribeJobName}, Filtered by: ${filterBy}, IsUserJob: ${isUserJob}`
                            );

                            return isUserJob ? job : null;
                        } catch (error) {
                            console.error(`Failed to fetch details for job ${job.MedicalScribeJobName}:`, error);
                            return null;
                        }
                    })
                );

                const filteredResults = detailedJobSummaries.filter((job): job is MedicalScribeJobSummary => job !== null);

                if (listHealthScribeJobsRsp?.NextToken) {
                    setHealthScribeJobs((prevHealthScribeJobs) => prevHealthScribeJobs.concat(filteredResults));
                } else {
                    setHealthScribeJobs(filteredResults);
                }

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
        },
        [addFlashMessage, setTableLoading, setHealthScribeJobs, setMoreHealthScribeJobs, filterBy, clinicName, loginId]
    );

    const openEndPaginationProp = useMemo(() => {
        if (Object.keys(moreHealthScribeJobs).length > 0) {
            return { openEnd: true };
        } else {
            return {};
        }
    }, [moreHealthScribeJobs]);

    const { collectionProps, paginationProps } = useCollection(healthScribeJobs, {
        filtering: {
            empty: <TableEmptyState title="No HealthScribe jobs" subtitle="Try clearing the search filter." />,
            noMatch: (
                <TableEmptyState
                    title="No matches"
                    subtitle="We cannot find a match."
                    action={<Button onClick={() => setShowFiltered(false)}>Show All</Button>}
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
                        filterBy={filterBy}
                        loginId={loginId}
                        clinicName={clinicName}
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
            <Button onClick={() => setFilterBy(filterBy === 'UserName' ? 'ClinicName' : 'UserName')}>
                {filterBy === 'UserName' ? 'Filter by ClinicName' : 'Filter by UserName'}
            </Button>
        </>
    );
}
