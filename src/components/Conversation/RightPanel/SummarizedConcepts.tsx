// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useEffect, useMemo, useState } from 'react';

import TextContent from '@cloudscape-design/components/text-content';

import toast from 'react-hot-toast';
import WaveSurfer from 'wavesurfer.js';

import { ExtractedHealthData, SummarySectionEntityMapping } from '@/types/ComprehendMedical';
import { IAuraClinicalDocOutputSection, ITranscriptSegments } from '@/types/HealthScribe';
import toTitleCase from '@/utils/toTitleCase';

import { HighlightId } from '../types';
import { SummaryListDefault } from './SummaryList';
import { SECTION_ORDER } from './sectionOrder';
import { fetchSummaryJson, mergeHealthScribeOutputWithComprehendMedicalOutput, transformToSegmentExtractedData } from './summarizedConceptsUtils';

type SummarizedConceptsProps = {
    jobName: string; // Add this prop
    sections: IAuraClinicalDocOutputSection[];
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
    const [sections, setSections] = useState<any[]>([]);

    useEffect(() => {
        async function loadSummary() {
            try {
                const summaryData = await fetchSummaryJson(jobName);
                setSections(summaryData.ClinicalDocumentation.Sections);
            } catch (error) {
                console.error('Error loading summary:', error);
                toast.error('Failed to load summary');
            }
        }
        loadSummary();
    }, [jobName]);

    
    useEffect(() => {
        if (!highlightId.selectedSegmentId) setCurrentSegment('');
    }, [highlightId]);

    const handleSummaryChange = (sectionName: string, index: number, newContent: string) => {
        onSummaryChange(sectionName, index, newContent);
    };

    const sectionsWithExtractedData: SummarySectionEntityMapping[] = useMemo(
        () => mergeHealthScribeOutputWithComprehendMedicalOutput(sections, extractedHealthData),
        [sections, extractedHealthData]
    );

    function handleSegmentClick(SummarizedSegment: string, EvidenceLinks: { SegmentId: string }[]) {
        let currentIdLocal = currentId;
        if (currentSegment !== SummarizedSegment) {
            setCurrentSegment(SummarizedSegment);
            setCurrentId(0);
            currentIdLocal = 0;
        }
        const id = EvidenceLinks[currentIdLocal].SegmentId;
        // Set state back to Conversation, used to highlight the transcript in LeftPanel
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

    return (
        <>
            {sections
                .sort((a, b) => SECTION_ORDER.indexOf(a.SectionName) - SECTION_ORDER.indexOf(b.SectionName) || 1)
                .map(({ SectionName, Summary }, i) => {
                    const sectionExtractedHealthData = extractedHealthData.find(s => s.SectionName === SectionName);
                    const transformedExtractedData = transformToSegmentExtractedData(sectionExtractedHealthData?.ExtractedEntities);
                    
                    return (
                        <div key={`insightsSection_${i}`}>
                            <TextContent>
                                <h3>{toTitleCase(SectionName.replace(/_/g, ' '))}</h3>
                            </TextContent>
                            <SummaryListDefault
                                sectionName={SectionName}
                                summary={Summary}
                                summaryExtractedHealthData={transformedExtractedData}
                                acceptableConfidence={acceptableConfidence}
                                currentSegment={currentSegment}
                                handleSegmentClick={handleSegmentClick}
                                onSummaryChange={(index, newContent) =>
                                    handleSummaryChange(SectionName, index, newContent)
                                }
                            />
                        </div>
                    );
                })}
        </>
    );
}