import React, { useEffect, useMemo, useState } from 'react';

import { MultiselectProps } from '@cloudscape-design/components';

import { DetectEntitiesV2Response } from '@aws-sdk/client-comprehendmedical';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MedicalScribeOutput } from '@aws-sdk/client-transcribe';
import toast from 'react-hot-toast';
import WaveSurfer from 'wavesurfer.js';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useS3 } from '@/hooks/useS3';
import { ExtractedHealthData } from '@/types/ComprehendMedical';
import { IAuraTranscriptOutput, ITranscriptSegments } from '@/types/HealthScribe';
import { detectEntitiesFromComprehendMedical } from '@/utils/ComprehendMedicalApi';
import { getCredentials } from '@/utils/Sdk';

import LoadingContainer from '../Common/LoadingContainer';
import ScrollingContainer from '../Common/ScrollingContainer';
import { HighlightId } from '../types';
import { RightPanelActions, RightPanelSettings } from './RightPanelComponents';
import SummarizedConcepts from './SummarizedConcepts';
import { calculateNereUnits } from './rightPanelUtils';
import { fetchSummaryJson, processSummarizedSegment } from './summarizedConceptsUtils';

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

function formatName(sectionName: string) {
    const words = sectionName.split('_');
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

/*  Old getSetSummary from not JSON
export function getSetSummary(
    clinicalDocument: IAuraClinicalDocOutput | null,
    selectedOptions: MultiselectProps.Option[]
) {
    if (!Array.isArray(clinicalDocument?.ClinicalDocumentation?.Sections)) return '';
    let setSummary = '';

    const selectedSections = new Set(selectedOptions.map((option) => option.value));

    for (const section of clinicalDocument.ClinicalDocumentation.Sections) {
        if (selectedSections.has(section.SectionName)) {
            setSummary += `${formatName(section.SectionName)}\n`;
            for (const summary of section.Summary) {
                setSummary += `${summary.SummarizedSegment}\n`;
            }
            setSummary += '\n';
        }
    }

    return setSummary;
}
*/

export async function getSetSummary(
    jobName: string | undefined,
    selectedOptions: MultiselectProps.Option[]
): Promise<string> {
    if (!jobName) {
        console.error('jobName is undefined');
        return '';
    }

    try {
        const s3Client = new S3Client({
            region: 'us-east-1',
            credentials: await getCredentials(),
        });

        const [outputBucket, getUploadMetadata] = useS3();
        if (!outputBucket) {
            console.error('Output bucket information is missing in get');
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
        const clinicalDocument = JSON.parse(originalContent);

        let setSummary = '';
        const selectedSections = new Set(selectedOptions.map((option) => option.value));

        if (Array.isArray(clinicalDocument?.ClinicalDocumentation?.Sections)) {
            for (const section of clinicalDocument.ClinicalDocumentation.Sections) {
                if (selectedSections.has(section.SectionName)) {
                    setSummary += `${formatName(section.SectionName)}\n`;
                    for (const summary of section.Summary) {
                        setSummary += `${summary.SummarizedSegment}\n`;
                    }
                    setSummary += '\n';
                }
            }
        }

        return setSummary;
    } catch (error) {
        console.error('Error fetching summary from S3:', error);
        return 'Error fetching summary';
    }
}

type RightPanelProps = {
    jobLoading: boolean;
    summaryData: SummaryData | null;
    transcriptFile: IAuraTranscriptOutput | null;
    highlightId: HighlightId;
    setHighlightId: React.Dispatch<React.SetStateAction<HighlightId>>;
    wavesurfer: React.MutableRefObject<WaveSurfer | undefined>;
    jobName: string;
    loginId: string;
    clinicName: string;
    outputBucket: MedicalScribeOutput | null;
    refreshSummaryData: () => Promise<void>;
};

export default function RightPanel({
    jobLoading,
    transcriptFile,
    highlightId,
    setHighlightId,
    wavesurfer,
    jobName,
    loginId,
    clinicName,
    outputBucket,
    refreshSummaryData,
}: RightPanelProps) {
    console.log('RightPanel rendered with jobName:', jobName);
    const [extractingData, setExtractingData] = useState<boolean>(false);
    const [extractedHealthData, setExtractedHealthData] = useState<ExtractedHealthData[]>([]);
    const [rightPanelSettingsOpen, setRightPanelSettingsOpen] = useState<boolean>(false);
    const [acceptableConfidence, setAcceptableConfidence] = useLocalStorage<number>(
        'Insights-Comprehend-Medical-Confidence-Threshold',
        75.0
    );
    const [summaryChanges, setSummaryChanges] = useState<Record<string, Record<number, string>>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function loadSummaryJson() {
            setIsLoading(true);
            if (jobName) {
                try {
                    console.log(`Attempting to load summary for job: ${jobName}`);
                    const data = await fetchSummaryJson(jobName);
                    console.log('Summary data loaded:', data);
                    setSummaryData(data);
                } catch (error) {
                    console.error('Failed to load summary.json:', error);
                } finally {
                    setIsLoading(false);
                }
            } else {
                console.warn('No jobName provided, skipping summary load');
                setIsLoading(false);
            }
        }
        loadSummaryJson();
    }, [jobName]);

    const handleSaveChanges = async () => {
        setIsSaving(true);
        try {
            if (!summaryData) {
                throw new Error('No summary data available');
            }

            const s3Client = new S3Client({
                region: 'us-east-1',
                credentials: await getCredentials(),
            });

            const [outputBucket] = useS3();
            if (!outputBucket) {
                throw new Error('Output bucket information is missing');
            }

            const key = `${jobName}/summary.json`;

            const updatedData: SummaryData = {
                ...summaryData,
                ClinicalDocumentation: {
                    Sections: [...summaryData.ClinicalDocumentation.Sections],
                },
            };

            for (const [sectionName, sectionChanges] of Object.entries(summaryChanges)) {
                const sectionIndex = updatedData.ClinicalDocumentation.Sections.findIndex(
                    (s) => s.SectionName === sectionName
                );
                if (sectionIndex !== -1) {
                    const section = updatedData.ClinicalDocumentation.Sections[sectionIndex];
                    for (const [index, newContent] of Object.entries(sectionChanges)) {
                        const indexNum = parseInt(index);
                        if (section.Summary[indexNum]) {
                            section.Summary[indexNum].SummarizedSegment = newContent;
                        }
                    }
                }
            }

            updatedData.lastModified = new Date().toISOString();
            updatedData.modifiedBy = loginId;
            updatedData.clinicName = clinicName;

            const putParams = {
                Bucket: outputBucket,
                Key: key,
                Body: JSON.stringify(updatedData, null, 2),
                ContentType: 'application/json',
            };
            const putCommand = new PutObjectCommand(putParams);
            await s3Client.send(putCommand);

            setSummaryData(updatedData);

            await refreshSummaryData();
            setSummaryChanges({});
            toast.success('Changes saved successfully');
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
        return (summaryData?.ClinicalDocumentation.Sections.length ?? 0) > 0;
    }, [summaryData]);

    async function handleExtractHealthData() {
        if (!summaryData?.ClinicalDocumentation?.Sections) return;
        setExtractingData(true);

        const buildExtractedHealthData = [];
        for (const section of summaryData.ClinicalDocumentation.Sections) {
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

    const clinicalDocumentNereUnits = useMemo(() => calculateNereUnits(summaryData), [summaryData]);

    if (jobLoading || isLoading) {
        return <LoadingContainer containerTitle="Insights" text="Loading Insights" />;
    } else if (summaryData == null) {
        return <LoadingContainer containerTitle="Insights" text="No summary data available" />;
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
                    jobName={jobName}
                    summaryData={summaryData}
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
