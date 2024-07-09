// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useMemo, useState, useEffect } from 'react';

import { DetectEntitiesV2Response } from '@aws-sdk/client-comprehendmedical';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MedicalScribeOutput } from '@aws-sdk/client-transcribe';
import toast from 'react-hot-toast';
import { Readable } from 'stream';
import WaveSurfer from 'wavesurfer.js';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useS3 } from '@/hooks/useS3';
import { ExtractedHealthData } from '@/types/ComprehendMedical';
import {
    IAuraClinicalDocOutput,
    IAuraClinicalDocOutputSection,
    IAuraTranscriptOutput,
    ITranscriptSegments,
} from '@/types/HealthScribe';
import { detectEntitiesFromComprehendMedical } from '@/utils/ComprehendMedicalApi';

import LoadingContainer from '../Common/LoadingContainer';
import ScrollingContainer from '../Common/ScrollingContainer';
import { HighlightId } from '../types';
import { RightPanelActions, RightPanelSettings } from './RightPanelComponents';
import SummarizedConcepts from './SummarizedConcepts';
import { calculateNereUnits } from './rightPanelUtils';
import { processSummarizedSegment } from './summarizedConceptsUtils';
import { getCredentials } from '@/utils/Sdk';

type RightPanelProps = {
    jobLoading: boolean;
    clinicalDocument: IAuraClinicalDocOutput | null;
    transcriptFile: IAuraTranscriptOutput | null;
    highlightId: HighlightId;
    setHighlightId: React.Dispatch<React.SetStateAction<HighlightId>>;
    wavesurfer: React.MutableRefObject<WaveSurfer | undefined>;
    jobName: string;
    loginId: string;
    clinicName: string;
    outputBucket: MedicalScribeOutput | null;
};

export default function RightPanel({
    jobLoading,
    clinicalDocument,
    transcriptFile,
    highlightId,
    setHighlightId,
    wavesurfer,
    jobName,
    loginId,
    clinicName,
    outputBucket,
}: RightPanelProps) {
    const [extractingData, setExtractingData] = useState<boolean>(false);
    const [extractedHealthData, setExtractedHealthData] = useState<ExtractedHealthData[]>([]);
    const [rightPanelSettingsOpen, setRightPanelSettingsOpen] = useState<boolean>(false);
    const [acceptableConfidence, setAcceptableConfidence] = useLocalStorage<number>(
        'Insights-Comprehend-Medical-Confidence-Threshold',
        75.0
    );
    const [summaryChanges, setSummaryChanges] = useState<Record<string, Record<number, string>>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [s3Client, setS3Client] = useState<S3Client | null>(null);

    useEffect(() => {
        const initializeS3Client = async () => {
            const credentials = await getCredentials();
            const client = new S3Client({
                region: 'us-east-1', // Hardcoded to match the access point region
                credentials,
            });
            setS3Client(client);
        };
        initializeS3Client();
    }, []);

    const handleSaveChanges = async () => {
        if (!s3Client) return;

        setIsSaving(true);
        try {
            const [outputBucket, getUploadMetadata] = useS3();
            if (!outputBucket) {
                throw new Error('Output bucket information is missing');
            }

            // Make sure bucketName is a string

            const savePromises = Object.entries(summaryChanges).map(async ([sectionName, sectionChanges]) => {
                const originalKey = `${jobName}/`; // Adjust this path as needed

                // Get the original content
                const getParams = {
                    Bucket: outputBucket, // Use the same bucket as in your submitJob function
                    Key: originalKey,
                };
                const getCommand = new GetObjectCommand(getParams);
                const originalObject = await s3Client.send(getCommand);

                let originalContent = {};
                if (originalObject.Body instanceof Readable) {
                    const chunks: Uint8Array[] = [];
                    for await (const chunk of originalObject.Body) {
                        chunks.push(chunk);
                    }
                    const buffer = Buffer.concat(chunks);
                    originalContent = JSON.parse(buffer.toString('utf-8'));
                }

                // Merge changes with original content
                const updatedContent = {
                    ...originalContent,
                    ...sectionChanges,
                    lastModified: new Date().toISOString(),
                    modifiedBy: loginId,
                    clinicName: clinicName,
                };

                // Save the updated content back to S3
                const putParams = {
                    Bucket: outputBucket,
                    Key: originalKey,
                    Body: JSON.stringify(updatedContent),
                    ContentType: 'application/json',
                };
                const putCommand = new PutObjectCommand(putParams);
                return s3Client.send(putCommand);
            });

            await Promise.all(savePromises);

            toast.success('Changes saved successfully');
            setSummaryChanges({});
        } catch (error) {
            console.error('Error saving changes:', error);
            toast.error('Failed to save changes');
        } finally {
            setIsSaving(false);
        }
    };

    const hasSummaryChanges = Object.keys(summaryChanges).length > 0;

    const segmentById: { [key: string]: ITranscriptSegments } = useMemo(() => {
        if (transcriptFile == null) return {};
        return transcriptFile.Conversation.TranscriptSegments.reduce((acc, seg) => {
            return { ...acc, [seg.SegmentId]: seg };
        }, {});
    }, [transcriptFile]);

    const hasInsightSections: boolean = useMemo(() => {
        if (typeof clinicalDocument?.ClinicalDocumentation?.Sections === 'undefined') return false;
        return clinicalDocument?.ClinicalDocumentation?.Sections?.length > 0;
    }, [clinicalDocument]);

    async function handleExtractHealthData() {
        if (!Array.isArray(clinicalDocument?.ClinicalDocumentation?.Sections)) return;
        setExtractingData(true);

        const buildExtractedHealthData = [];
        for (const section of clinicalDocument.ClinicalDocumentation.Sections) {
            const sectionEntities: DetectEntitiesV2Response[] = [];
            for (const summary of section.Summary) {
                const summarizedSegment = processSummarizedSegment(summary.SummarizedSegment);
                const detectedEntities = (await detectEntitiesFromComprehendMedical(
                    summarizedSegment
                )) as DetectEntitiesV2Response;
                sectionEntities.push(detectedEntities);
            }
            buildExtractedHealthData.push({
                SectionName: section.SectionName,
                ExtractedEntities: sectionEntities,
            });
        }
        setExtractedHealthData(buildExtractedHealthData);

        setExtractingData(false);
    }

    // Calculate the number of CM units (100-character segments) in the clinical document.
    const clinicalDocumentNereUnits = useMemo(() => calculateNereUnits(clinicalDocument), [clinicalDocument]);

    if (jobLoading || clinicalDocument == null) {
        return <LoadingContainer containerTitle="Insights" text="Loading Insights" />;
    } else {
        return (
            <ScrollingContainer
                containerTitle="Insights"
                containerActions={
                    <RightPanelActions
                        hasInsightSections={hasInsightSections}
                        dataExtracted={extractedHealthData.length > 0}
                        extractingData={extractingData}
                        clinicalDocumentNereUnits={clinicalDocumentNereUnits}
                        setRightPanelSettingsOpen={setRightPanelSettingsOpen}
                        handleExtractHealthData={handleExtractHealthData}
                        handleSaveChanges={handleSaveChanges}
                        isSaving={isSaving}
                        hasSummaryChanges={hasSummaryChanges}
                    />
                }
            >
                <RightPanelSettings
                    rightPanelSettingsOpen={rightPanelSettingsOpen}
                    setRightPanelSettingsOpen={setRightPanelSettingsOpen}
                    acceptableConfidence={acceptableConfidence}
                    setAcceptableConfidence={setAcceptableConfidence}
                />
                <SummarizedConcepts
                    sections={clinicalDocument.ClinicalDocumentation.Sections as IAuraClinicalDocOutputSection[]}
                    extractedHealthData={extractedHealthData}
                    acceptableConfidence={acceptableConfidence}
                    highlightId={highlightId}
                    setHighlightId={setHighlightId}
                    segmentById={segmentById}
                    wavesurfer={wavesurfer}
                    onSummaryChange={(sectionName, index, newContent) => {
                        setSummaryChanges((prev) => ({
                            ...prev,
                            [sectionName]: {
                                ...(prev[sectionName] || {}),
                                [index]: newContent,
                            },
                        }));
                    }}
                />
            </ScrollingContainer>
        );
    }
}
