// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
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

//import { sendInsightsEmail } from '@/utils/EmailUtils';

type DeleteModalProps = {
    selectedHealthScribeJob: MedicalScribeJobSummary[];
    deleteModalActive: boolean;
    setDeleteModalActive: React.Dispatch<React.SetStateAction<boolean>>;
    refreshTable: () => void;
};
function DeleteModal({
    selectedHealthScribeJob,
    deleteModalActive,
    setDeleteModalActive,
    refreshTable,
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
        }
        setDeleteModalActive(false);
        setIsDeleting(false);
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
};
function TableHeaderActions({
    setSearchParams,
    selectedHealthScribeJob,
    setDeleteModalActive,
    refreshTable,
    showFiltered,
    setShowFiltered,
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
                {showFiltered ? 'Display All of Your Clinics Jobs' : 'Show Your Jobs'}
            </Button>
        </SpaceBetween>
    );
}

const statusSelections = [
    { label: 'All', value: 'ALL' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'Queued', value: 'QUEUED' },
    { label: 'Failed', value: 'FAILED' },
];
type TableHeaderProps = {
    selectedHealthScribeJob: MedicalScribeJobSummary[];
    headerCounterText: string;
    listHealthScribeJobs: (searchFilter: ListHealthScribeJobsProps) => Promise<void>;
    showFiltered: boolean;
    setShowFiltered: React.Dispatch<React.SetStateAction<boolean>>;
};
function TableHeader({
    selectedHealthScribeJob,
    headerCounterText,
    listHealthScribeJobs,
    showFiltered,
    setShowFiltered,
}: TableHeaderProps) {
    const [deleteModalActive, setDeleteModalActive] = useState<boolean>(false);
    const [searchParams, setSearchParams] = useState<ListHealthScribeJobsProps>({});
    const [debouncedSearchParams] = useDebounce(searchParams, 500);
    //const [email, setEmail] = useState('');

    // Update list initially & deboucned search params
    useEffect(() => {
        listHealthScribeJobs(debouncedSearchParams).catch(console.error);
    }, [debouncedSearchParams]);

    // Update searchParam to id: value
    function handleInputChange(id: string, value: string) {
        setSearchParams((currentSearchParams) => {
            return {
                ...currentSearchParams,
                [id]: value,
            };
        });
    }

    /*function handleEmailChange(event) {
        setEmail(event.target.value);
    }

    async function handleSendEmail() {
        if (email) {
            try {
                await sendInsightsEmail(email, selectedHealthScribeJob);
                alert('Insights sent successfully');
            } catch (error) {
                alert('Error sending insights');
            }
        } else {
            alert('Please enter a valid email address');
        }
    }*/

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
                    />
                }
            >
                Conversations
            </Header>
            <Form>
                <Grid gridDefinition={[{ colspan: 5 }, { colspan: 3 }]}>
                    <Input
                        placeholder="HealthScribe Job Name"
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
}

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
