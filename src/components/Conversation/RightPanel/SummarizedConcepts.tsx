import React, { useState } from 'react';

import Button from '@cloudscape-design/components/button';
import TextContent from '@cloudscape-design/components/text-content';

import toast from 'react-hot-toast';
import WaveSurfer from 'wavesurfer.js';

import { ExtractedHealthData } from '@/types/ComprehendMedical';
import { ITranscriptSegments } from '@/types/HealthScribe';
import toTitleCase from '@/utils/toTitleCase';

import { HighlightId } from '../types';
import { SummaryListDefault } from './SummaryList';
import { SECTION_ORDER } from './sectionOrder';
import { transformToSegmentExtractedData } from './summarizedConceptsUtils';

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

type SummarizedConceptsProps = {
    jobName: string;
    summaryData: SummaryData;
    extractedHealthData: ExtractedHealthData[];
    acceptableConfidence: number;
    highlightId: HighlightId;
    setHighlightId: React.Dispatch<React.SetStateAction<HighlightId>>;
    segmentById: {
        [key: string]: ITranscriptSegments;
    };
    wavesurfer: React.MutableRefObject<WaveSurfer | undefined>;
    onSummaryChange: (sectionName: string, index: number, newContent: string) => void;
};

export default function SummarizedConcepts({
    jobName,
    summaryData,
    extractedHealthData,
    acceptableConfidence,
    highlightId,
    setHighlightId,
    segmentById,
    wavesurfer,
    onSummaryChange,
}: SummarizedConceptsProps) {
    const [currentId, setCurrentId] = useState(0);
    const [currentSegment, setCurrentSegment] = useState<string>('');

    function handleSegmentClick(SummarizedSegment: string, EvidenceLinks: { SegmentId: string }[]) {
        let currentIdLocal = currentId;
        if (currentSegment !== SummarizedSegment) {
            setCurrentSegment(SummarizedSegment);
            setCurrentId(0);
            currentIdLocal = 0;
        }
        const id = EvidenceLinks[currentIdLocal].SegmentId;
        const newHighlightId = {
            allSegmentIds: EvidenceLinks.map((i) => i.SegmentId),
            selectedSegmentId: id,
        };
        setHighlightId(newHighlightId);

        const current = wavesurfer.current?.getDuration();
        const toastId = currentIdLocal + 1;
        if (current) {
            const seekId = segmentById[id].BeginAudioTime / current;
            wavesurfer.current?.seekTo(seekId);
            if (currentIdLocal < EvidenceLinks.length - 1) {
                setCurrentId(currentIdLocal + 1);
            } else {
                setCurrentId(0);
            }
        } else if (!current) {
            if (currentIdLocal < EvidenceLinks.length - 1) {
                setCurrentId(currentIdLocal + 1);
            } else {
                setCurrentId(0);
            }
            toast.success(`Jump Successful. Sentence ${toastId} of ${EvidenceLinks.length}. Audio not yet ready`);
        } else {
            toast.error('Unable to jump to that Clinical Attribute');
        }
    }

    function copyToClipboard(text: string) {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                toast.success('Section text copied to clipboard');
            })
            .catch(() => {
                toast.error('Failed to copy text');
            });
    }

    return (
        <>
            {summaryData.ClinicalDocumentation.Sections.sort(
                (a, b) => SECTION_ORDER.indexOf(a.SectionName) - SECTION_ORDER.indexOf(b.SectionName) || 1
            ).map(({ SectionName, Summary }, i) => {
                const sectionExtractedHealthData = extractedHealthData.find((s) => s.SectionName === SectionName);
                const transformedExtractedData = transformToSegmentExtractedData(
                    sectionExtractedHealthData?.ExtractedEntities
                );

                const sectionText = Summary.map((s) => s.SummarizedSegment).join('\n');

                return (
                    <div key={`insightsSection_${i}  `}>
                        <TextContent>
                            <h3 style={{ display: 'flex', alignItems: 'center' }}>
                                {toTitleCase(SectionName.replace(/_/g, ' '))}
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '32px', // Button size
                                        height: '32px', // Button size
                                        backgroundColor: 'white',
                                        borderRadius: '50%', // Makes the button a circle
                                        marginLeft: '8px', // Space between section name and button
                                        padding: '4px', // Adjust padding to control space inside the circle
                                    }}
                                    onClick={() => copyToClipboard(sectionText)}
                                >
                                    <img
                                        src="/copy-to-clipboard.svg"
                                        alt="Copy to clipboard"
                                        style={{
                                            height: '16px',
                                            width: '16px',
                                        }}
                                    />
                                </div>
                            </h3>
                        </TextContent>
                        <SummaryListDefault
                            sectionName={SectionName}
                            summary={Summary}
                            summaryExtractedHealthData={transformedExtractedData}
                            acceptableConfidence={acceptableConfidence}
                            currentSegment={currentSegment}
                            handleSegmentClick={handleSegmentClick}
                            onSummaryChange={(index, newContent) => onSummaryChange(SectionName, index, newContent)}
                        />
                    </div>
                );
            })}
        </>
    );
}
