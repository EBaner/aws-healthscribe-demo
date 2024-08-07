// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { Suspense, lazy, useEffect, useState } from 'react';

import { useParams } from 'react-router-dom';

import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';

import { MedicalScribeJob } from '@aws-sdk/client-transcribe';

import ModalLoader from '@/components/SuspenseLoader/ModalLoader';
import { useAudio } from '@/hooks/useAudio';
import { useAuthContext } from '@/store/auth';
import { useNotificationsContext } from '@/store/notifications';
import { IAuraTranscriptOutput } from '@/types/HealthScribe';
import { getHealthScribeJob } from '@/utils/HealthScribeApi';
import { getObject, getS3Object } from '@/utils/S3Api';

import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';
import { fetchSummaryJson } from './RightPanel/summarizedConceptsUtils';
import TopPanel from './TopPanel';

const ViewOutput = lazy(() => import('./ViewOutput'));

type SummaryData = {
    ClinicalDocumentation: {
        Sections: {
            SectionName: string;
            Summary: {
                EvidenceLinks: { SegmentId: string }[];
                SummarizedSegment: string;
            }[];
        }[];
    };
    lastModified: string;
    modifiedBy: string;
    clinicName: string;
};

export default function Conversation() {
    const { conversationName } = useParams();
    const { addFlashMessage } = useNotificationsContext();
    const { isUserAuthenticated, user, signOut } = useAuthContext();

    const [jobLoading, setJobLoading] = useState(true);
    const [jobDetails, setJobDetails] = useState<MedicalScribeJob | null>(null);
    const [showOutputModal, setShowOutputModal] = useState<boolean>(false);
    const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
    const [transcriptFile, setTranscriptFile] = useState<IAuraTranscriptOutput | null>(null);

    const [
        wavesurfer,
        audioReady,
        setAudioReady,
        audioTime,
        setAudioTime,
        smallTalkCheck,
        setSmallTalkCheck,
        highlightId,
        setHighlightId,
    ] = useAudio();

    async function fetchLatestSummaryData(jobName: string) {
        try {
            const latestSummaryData = await fetchSummaryJson(jobName);
            setSummaryData(latestSummaryData);
        } catch (error) {
            console.error('Failed to fetch latest summary data:', error);
        }
    }

    useEffect(() => {
        async function getJob(conversationName: string) {
            try {
                setJobLoading(true);
                const getHealthScribeJobRsp = await getHealthScribeJob({ MedicalScribeJobName: conversationName });
                const medicalScribeJob = getHealthScribeJobRsp?.MedicalScribeJob;
                const userTag = jobDetails?.Tags?.find((tag) => tag.Key === 'UserName');
                const clinicTag = jobDetails?.Tags?.find((tag) => tag.Key === 'Clinic');

                if (!medicalScribeJob) {
                    return;
                }

                setJobDetails(medicalScribeJob);

                const summaryData = await fetchSummaryJson(conversationName);
                setSummaryData(summaryData);

                const transcriptFileUri = medicalScribeJob.MedicalScribeOutput?.TranscriptFileUri;
                const transcriptFileRsp = await getObject(getS3Object(transcriptFileUri || ''));
                setTranscriptFile(JSON.parse((await transcriptFileRsp?.Body?.transformToString()) || ''));
            } catch (e) {
                setJobDetails(null);
                setJobLoading(false);
                addFlashMessage({
                    id: e?.toString() || 'GetHealthScribeJob error',
                    header: 'Conversation Error',
                    content: e?.toString() || 'GetHealthScribeJob error',
                    type: 'error',
                });
            }
            setJobLoading(false);
        }
        if (!conversationName) {
            return;
        } else {
            getJob(conversationName).catch(console.error);
        }
    }, [conversationName, user?.username]);

    return (
        <ContentLayout>
            {showOutputModal && (
                <Suspense fallback={<ModalLoader />}>
                    <ViewOutput
                        setVisible={setShowOutputModal}
                        transcriptString={JSON.stringify(transcriptFile || 'Loading...', null, 2)}
                        clinicalDocumentString={JSON.stringify(summaryData || 'Loading...', null, 2)}
                    />
                </Suspense>
            )}
            <Grid
                gridDefinition={[
                    { colspan: { default: 12 } },
                    { colspan: { default: 6 } },
                    { colspan: { default: 6 } },
                ]}
            >
                <TopPanel
                    jobLoading={jobLoading}
                    jobDetails={jobDetails}
                    transcriptFile={transcriptFile}
                    wavesurfer={wavesurfer}
                    smallTalkCheck={smallTalkCheck}
                    setSmallTalkCheck={setSmallTalkCheck}
                    setAudioTime={setAudioTime}
                    setAudioReady={setAudioReady}
                    setShowOutputModal={setShowOutputModal}
                    clinicalDocument={summaryData}
                />
                <LeftPanel
                    jobLoading={jobLoading}
                    transcriptFile={transcriptFile}
                    highlightId={highlightId}
                    setHighlightId={setHighlightId}
                    wavesurfer={wavesurfer}
                    smallTalkCheck={smallTalkCheck}
                    audioTime={audioTime}
                    setAudioTime={setAudioTime}
                    audioReady={audioReady}
                />
                <RightPanel
                    jobLoading={jobLoading}
                    summaryData={summaryData}
                    transcriptFile={transcriptFile}
                    highlightId={highlightId}
                    setHighlightId={setHighlightId}
                    wavesurfer={wavesurfer}
                    jobName={jobDetails?.MedicalScribeJobName || ''}
                    loginId={user?.username || ''}
                    outputBucket={jobDetails?.MedicalScribeOutput || null}
                    clinicName={jobDetails?.Tags?.find((tag) => tag.Key === 'Clinic')?.Value || ''}
                    refreshSummaryData={() => fetchLatestSummaryData(jobDetails?.MedicalScribeJobName || '')}
                />
            </Grid>
        </ContentLayout>
    );
}
