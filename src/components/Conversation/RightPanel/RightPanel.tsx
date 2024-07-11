import React, { useMemo, useState } from 'react';

import { DetectEntitiesV2Response } from '@aws-sdk/client-comprehendmedical';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MedicalScribeOutput } from '@aws-sdk/client-transcribe';
import toast from 'react-hot-toast';
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
import { getCredentials } from '@/utils/Sdk';

import LoadingContainer from '../Common/LoadingContainer';
import ScrollingContainer from '../Common/ScrollingContainer';
import { HighlightId } from '../types';
import { RightPanelActions, RightPanelSettings } from './RightPanelComponents';
import SummarizedConcepts from './SummarizedConcepts';
import { calculateNereUnits } from './rightPanelUtils';
import { processSummarizedSegment } from './summarizedConceptsUtils';

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

    const handleSaveChanges = async () => {
        setIsSaving(true);
        try {
            const s3Client = new S3Client({
                region: 'us-east-1',
                credentials: await getCredentials(),
            });

            const [outputBucket, getUploadMetadata] = useS3();
            if (!outputBucket) {
                throw new Error('Output bucket information is missing');
            }

            const originalKey = `${jobName}/summary.json`;

            console.log(`Fetching from S3 with key: ${originalKey} in bucket: ${outputBucket}`);

            // Get the original content
            const getParams = {
                Bucket: outputBucket,
                Key: originalKey,
            };
            const getCommand = new GetObjectCommand(getParams);
            const originalObject = await s3Client.send(getCommand);

            let originalContent = '';
            if (originalObject.Body) {
                const stream = originalObject.Body as ReadableStream;
                const reader = stream.getReader();
                const decoder = new TextDecoder('utf-8');
                let result = '';
                let done = false;

                while (!done) {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;
                    if (value) {
                        result += decoder.decode(value, { stream: !done });
                    }
                }
                originalContent = result;
            }

            if (!originalContent) {
                throw new Error('Original content is empty');
            }

            const originalData = JSON.parse(originalContent);
            console.log('Original Data:', originalData);

            interface Section {
                SectionName: string;
                Summary: Array<{
                    SummarizedSegment: string;
                    EvidenceLinks?: Array<{ SegmentId: string }>;
                }>;
            }

            // Merge changes with original content
            const updatedData = { ...originalData };

            for (const [sectionName, sectionChanges] of Object.entries(summaryChanges)) {
                if (updatedData.ClinicalDocumentation && updatedData.ClinicalDocumentation.Sections) {
                    const section = updatedData.ClinicalDocumentation.Sections.find(
                        (s: Section) => s.SectionName === sectionName
                    );
                    if (section && section.Summary) {
                        for (const [index, newContent] of Object.entries(sectionChanges)) {
                            const indexNum = parseInt(index);
                            if (section.Summary[indexNum]) {
                                section.Summary[indexNum].SummarizedSegment = newContent;
                            }
                        }
                    }
                }
            }

            updatedData.lastModified = new Date().toISOString();
            updatedData.modifiedBy = loginId;
            updatedData.clinicName = clinicName;

            console.log('Updated Content:', updatedData);

            // Save the updated content back to S3
            const putParams = {
                Bucket: outputBucket,
                Key: originalKey,
                Body: JSON.stringify(updatedData, null, 2), // Indent for readability
                ContentType: 'application/json',
            };
            const putCommand = new PutObjectCommand(putParams);
            await s3Client.send(putCommand);

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
                    jobName= {jobName}
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
