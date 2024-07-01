import React, { useEffect, useMemo, useState } from 'react';

import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences from '@cloudscape-design/components/collection-preferences';
import Form from '@cloudscape-design/components/form';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';

import { MedicalScribeJobSummary } from '@aws-sdk/client-transcribe';
import { useDebounce } from 'use-debounce';

import { useNotificationsContext } from '@/store/notifications';
import { ListHealthScribeJobsProps, deleteHealthScribeJob } from '@/utils/HealthScribeApi';

import { TablePreferencesDef, collectionPreferencesProps } from './tablePrefs';
import { useAuthContext } from '@/store/auth';
import { fetchUserAttributes, getCurrentUser } from '@aws-amplify/auth';

type DeleteModalProps = {
    selectedHealthScribeJob: MedicalScribeJobSummary[];
    deleteModalActive: boolean;
    setDeleteModalActive: React.Dispatch<React.SetStateAction<boolean>>;
    refreshTable: () => void;
    filterBy: 'UserName' | 'ClinicName';
    loginId: string;
    clinicName: string | null;
};

const statusSelections = [
    { label: 'All', value: 'ALL' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'Queued', value: 'QUEUED' },
    { label: 'Failed', value: 'FAILED' },
];

function DeleteModal({
    selectedHealthScribeJob,
    deleteModalActive,
    setDeleteModalActive,
    refreshTable,
    filterBy,
    loginId,
    clinicName,
}: DeleteModalProps) {
    const { addFlashMessage } = useNotificationsContext();
    const [isDeleting, setIsDeleting] = useState<boolean>(false);

    async function doDelete(medicalScribeJobName: string) {
        if (!medicalScribeJobName) return;

        setIsDeleting(true);
        try {
            await deleteHealthScribeJob({ MedicalScribeJobName: medicalScribeJobName });
            refreshTable();
        } catch (err) {
            addFlashMessage({
                id: err?.toString() || 'Error deleting HealthScribe job',
                header: 'Error deleting HealthScribe job',
                content: err?.toString() || 'Error deleting HealthScribe job',
                type: 'error',
            });
        } finally {
            setDeleteModalActive(false);
            setIsDeleting(false);
        }
    }

    return (
        <Modal
            onDismiss={() => setDeleteModalActive(false)}
            visible={deleteModalActive}
            footer={
                <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button variant="link" disabled={isDeleting} onClick={() => setDeleteModalActive(false)}>
                            Cancel
                        </Button>
                        <Button
                            disabled={isDeleting}
                            variant="primary"
                            onClick={() => doDelete(selectedHealthScribeJob?.[0]?.MedicalScribeJobName || '')}
                        >
                            {isDeleting ? <Spinner /> : 'Delete'}
                        </Button>
                    </SpaceBetween>
                </Box>
            }
            header="Delete AWS HealthScribe Conversation"
        >
            <p>
                Permanently delete <strong>{selectedHealthScribeJob?.[0]?.MedicalScribeJobName || ''}</strong>. You
                cannot undo this action.
            </p>
            <Alert statusIconAriaLabel="Info">
                Proceeding with this action will delete the conversation but not the associated data (audio file,
                results JSON) from S3.
            </Alert>
        </Modal>
    );
}

type TableHeaderActionsProps = {
    setSearchParams: React.Dispatch<React.SetStateAction<ListHealthScribeJobsProps>>;
    selectedHealthScribeJob: MedicalScribeJobSummary[];
    setDeleteModalActive: React.Dispatch<React.SetStateAction<boolean>>;
    refreshTable: () => void;
    showFiltered: boolean;
    setShowFiltered: React.Dispatch<React.SetStateAction<boolean>>;
    filterBy: 'UserName' | 'ClinicName';
    loginId: string;
    clinicName: string | null;
    includeClinicFilter: boolean; // Add includeClinicFilter to the type definition
    setIncludeClinicFilter: React.Dispatch<React.SetStateAction<boolean>>;
};

function TableHeaderActions({
    setSearchParams,
    selectedHealthScribeJob,
    setDeleteModalActive,
    refreshTable,
    showFiltered,
    setShowFiltered,
    filterBy,
    loginId,
    clinicName,
}: TableHeaderActionsProps) {
    const DO_NOT_DELETE = ['Demo-Fatigue', 'Demo-Kidney', 'Demo-Knee'];

    // Disable HealthScribeJob action buttons (view metadata, view images) if nothing is selected
    const actionButtonDisabled = useMemo(
        () =>
            selectedHealthScribeJob.length === 0 ||
            !['COMPLETED', 'FAILED'].includes(selectedHealthScribeJob[0].MedicalScribeJobStatus || ''),
        [selectedHealthScribeJob]
    );

    return (
        <SpaceBetween direction="horizontal" size="s">
            <Button onClick={() => refreshTable()} iconName="refresh" />
            <Button onClick={() => setSearchParams({})}>Clear</Button>
            <Button
                onClick={() => setDeleteModalActive(true)}
                disabled={
                    actionButtonDisabled ||
                    DO_NOT_DELETE.includes(selectedHealthScribeJob[0].MedicalScribeJobName || '')
                }
            >
                Delete
            </Button>
            <Button onClick={() => setShowFiltered(!showFiltered)}>
                {showFiltered ? 'Show All' : 'Show Filtered'}
            </Button>
        </SpaceBetween>
    );
}

interface TableHeaderProps {
    selectedHealthScribeJob: MedicalScribeJobSummary[];
    headerCounterText: string;
    listHealthScribeJobs: (searchFilter: ListHealthScribeJobsProps) => Promise<void>;
    showFiltered: boolean;
    setShowFiltered: React.Dispatch<React.SetStateAction<boolean>>;
    includeClinicFilter: boolean;
    setIncludeClinicFilter: React.Dispatch<React.SetStateAction<boolean>>;
    filterBy: 'UserName' | 'ClinicName';
    setFilterBy: React.Dispatch<React.SetStateAction<'UserName' | 'ClinicName'>>;
}

const TableHeader: React.FC<TableHeaderProps> = ({
    selectedHealthScribeJob,
    headerCounterText,
    listHealthScribeJobs,
    showFiltered,
    setShowFiltered,
    includeClinicFilter,
    setIncludeClinicFilter,
    filterBy,
    setFilterBy,
}) => {
    const { user } = useAuthContext();
    const loginId = user?.signInDetails?.loginId || 'No username found';

    const [clinicName, setClinicName] = useState<string | null>(null);


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
        async function fetchClinicName() {
            try {
                const clinicName = await getUserAttributes(loginId);
                if (!clinicName) {
                    setClinicName('No clinic name found');
                    return;
                }
                setClinicName(clinicName);
            } catch (error) {
                console.error('Failed to fetch clinic name', error);
                // Handle the error appropriately
            }
        }

        fetchClinicName();
    }, [loginId]);

    const [deleteModalActive, setDeleteModalActive] = useState<boolean>(false);
    const [searchParams, setSearchParams] = useState<ListHealthScribeJobsProps>({});
    const [debouncedSearchParams] = useDebounce(searchParams, 500);

    // Update list initially & debounced search params
    useEffect(() => {
        listHealthScribeJobs(debouncedSearchParams).catch(console.error);
    }, [debouncedSearchParams]);

    // Update searchParam to id: value
    function handleInputChange(id: string, value: string) {
        setSearchParams((currentSearchParams) => ({
            ...currentSearchParams,
            [id]: value,
        }));
    }

    // Manual refresh function for the header actions
    function refreshTable() {
        listHealthScribeJobs(debouncedSearchParams).catch(console.error);
    }

    return (
        <SpaceBetween direction="vertical" size="m">
            <DeleteModal
                selectedHealthScribeJob={selectedHealthScribeJob}
                deleteModalActive={deleteModalActive}
                setDeleteModalActive={setDeleteModalActive}
                refreshTable={refreshTable}
                filterBy={filterBy}
                loginId={loginId}
                clinicName={clinicName}
            />
            <Header
                variant="awsui-h1-sticky"
                counter={headerCounterText}
                actions={
                    <TableHeaderActions
                        setSearchParams={setSearchParams}
                        selectedHealthScribeJob={selectedHealthScribeJob}
                        setDeleteModalActive={setDeleteModalActive}
                        refreshTable={refreshTable}
                        showFiltered={showFiltered}
                        setShowFiltered={setShowFiltered}
                        filterBy={filterBy}
                        loginId={loginId} // Pass loginId here
                        clinicName={clinicName} // Pass clinicName here
                        includeClinicFilter={includeClinicFilter}
                        setIncludeClinicFilter={setIncludeClinicFilter}
                    />
                }
            >
                Conversations
            </Header>
            <Form>
                <Grid gridDefinition={[{ colspan: 5 }, { colspan: 3 }]}>
                    <Input
                        placeholder={filterBy === 'UserName' ? 'Username' : 'Clinic Name'}
                        value={searchParams?.JobNameContains || ''}
                        onChange={({ detail }) => handleInputChange('JobNameContains', detail.value)}
                    />
                    <Select
                        selectedOption={statusSelections.find((s) => s.value === searchParams?.Status) || null}
                        onChange={({ detail }) => handleInputChange('Status', detail.selectedOption.value || 'ALL')}
                        options={statusSelections}
                        placeholder="Status"
                    />
                </Grid>
            </Form>
        </SpaceBetween>
    );
};

type TablePreferencesProps = {
    preferences: TablePreferencesDef;
    setPreferences: (newValue: TablePreferencesDef) => void;
};

function TablePreferences({ preferences, setPreferences }: TablePreferencesProps) {
    return (
        <CollectionPreferences
            {...collectionPreferencesProps}
            preferences={preferences}
            onConfirm={({ detail }) => setPreferences(detail)}
        />
    );
}

export { TableHeader, TablePreferences };
