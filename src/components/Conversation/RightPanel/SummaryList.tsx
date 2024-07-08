import React, { MutableRefObject, useEffect, useRef, useState } from 'react';

import * as awsui from '@cloudscape-design/design-tokens';
import Box from '@cloudscape-design/components/box';

import { SegmentExtractedData } from '@/types/ComprehendMedical';
import { IEvidence } from '@/types/HealthScribe';

import styles from './SummarizedConcepts.module.css';
import { ExtractedHealthDataWord } from './SummaryListComponents';
import { processSummarizedSegment } from './summarizedConceptsUtils';

type NoEntitiesProps = {
    handleInput: () => void;
    editableContent: string;
};

const NoEntities = React.forwardRef<HTMLDivElement, NoEntitiesProps>(
    ({ handleInput, editableContent }, forwardedRef) => {
        const [editing, setEditing] = useState(false);
        const ref = useRef<HTMLDivElement>(null);

        const handleFocus = () => {
            if (!editing && editableContent === 'No Clinical Entities') {
                setEditing(true);
                // Clear the content when editing starts
                if (ref.current) {
                    ref.current.innerText = '';
                }
            }
        };

        const handleBlur = () => {
            setEditing(false);
            // Restore the placeholder text if content is empty on blur
            if (ref.current?.innerText === '') {
                ref.current.innerText = 'No Clinical Entities';
            }
            // Call handleInput to update the parent component's state
            handleInput();
        };

        return (
            <div
                contentEditable
                suppressContentEditableWarning
                ref={ref as React.MutableRefObject<HTMLDivElement>}
                onFocus={handleFocus}
                onBlur={handleBlur}
                style={{ paddingLeft: '5px' }}
            >
                <Box variant="small">{editableContent}</Box>
            </div>
        );
    }
);

NoEntities.displayName = 'NoEntities';

type SummaryListDefaultProps = {
    sectionName: string;
    summary: IEvidence[];
    summaryExtractedHealthData?: SegmentExtractedData[];
    acceptableConfidence: number;
    currentSegment: string;
    handleSegmentClick: (SummarizedSegment: string, EvidenceLinks: { SegmentId: string }[]) => void;
};

export function SummaryListDefault({
    sectionName,
    summary,
    summaryExtractedHealthData,
    acceptableConfidence,
    currentSegment = '',
    handleSegmentClick,
}: SummaryListDefaultProps) {
    const editableRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [editableSummary, setEditableSummary] = useState<string[]>([]);
    const [emptySectionsContent, setEmptySectionsContent] = useState<string[]>([]);

    useEffect(() => {
        editableRefs.current = editableRefs.current.slice(0, summary.length);
        setEditableSummary(summary.map(({ SummarizedSegment }) => SummarizedSegment));
        setEmptySectionsContent(summary.map(() => 'No Clinical Entities'));
    }, [summary]);

    const handleInput = (index: number) => {
        const newSummary = editableRefs.current.map((ref) => ref?.innerText || '');
        setEditableSummary(newSummary);
    };

    const handleEmptySectionInput = (index: number) => {
        const newEmptySectionsContent = editableRefs.current.map((ref) => ref?.innerText || 'No Clinical Entities');
        setEmptySectionsContent(newEmptySectionsContent);
    };

    if (summary.length) {
        return (
            <ul className={styles.summaryList}>
                {summary.map(({ EvidenceLinks, SummarizedSegment }, sectionIndex) => {
                    if (SummarizedSegment === '') {
                        return (
                            <li key={`${sectionName}_${sectionIndex}`} className={styles.summaryListItem}>
                                <NoEntities
                                    ref={(el: HTMLDivElement | null) => (editableRefs.current[sectionIndex] = el)}
                                    handleInput={() => handleEmptySectionInput(sectionIndex)}
                                    editableContent={emptySectionsContent[sectionIndex]}
                                />
                            </li>
                        );
                    }

                    let sectionHeader = '';
                    let indent = false;
                    if (SummarizedSegment.endsWith('\n')) {
                        const splitSegment = SummarizedSegment.split('\n');
                        if (splitSegment.length === 3) {
                            sectionHeader = splitSegment[0];
                            SummarizedSegment = SummarizedSegment.substring(SummarizedSegment.indexOf('\n') + 1);
                        }
                        indent = true;
                    }
                    const sectionHeaderWordLength = sectionHeader ? sectionHeader.split(' ').length : 0;

                    const summaryItemDivStyle = {
                        color: awsui.colorTextBodyDefault,
                        backgroundColor:
                            currentSegment === SummarizedSegment ? awsui.colorBackgroundToggleCheckedDisabled : '',
                    };

                    if (summaryExtractedHealthData) {
                        const sectionExtractedData = summaryExtractedHealthData[sectionIndex];
                        return (
                            <div key={`${sectionName}_${sectionIndex}`}>
                                {sectionHeaderWordLength > 0 && (
                                    <div className={styles.summaryListItemSubHeader}>
                                        {sectionExtractedData.words
                                            .slice(0, sectionHeaderWordLength)
                                            .map(({ word, linkedId }, wordIndex) => (
                                                <ExtractedHealthDataWord
                                                    key={`${sectionName}_${sectionIndex}_${wordIndex}`}
                                                    linkedId={linkedId}
                                                    sectionExtractedData={sectionExtractedData}
                                                    word={word}
                                                    acceptableConfidence={acceptableConfidence}
                                                />
                                            ))}
                                    </div>
                                )}
                                <li className={`${styles.summaryListItem} ${indent && styles.summaryListItemIndent}`}>
                                    <div
                                        contentEditable
                                        suppressContentEditableWarning
                                        ref={(el: HTMLDivElement | null) => (editableRefs.current[sectionIndex] = el)}
                                        onInput={() => handleInput(sectionIndex)}
                                        onClick={() => handleSegmentClick(SummarizedSegment, EvidenceLinks)}
                                        className={styles.summarizedSegment}
                                        style={summaryItemDivStyle}
                                    >
                                        {sectionExtractedData.words
                                            .slice(sectionHeaderWordLength)
                                            .map(({ word, linkedId }, wordIndex) => {
                                                if (word === '-' && wordIndex <= 1) return false;

                                                return (
                                                    <ExtractedHealthDataWord
                                                        key={`${sectionName}_${sectionIndex}_${wordIndex}`}
                                                        linkedId={linkedId}
                                                        sectionExtractedData={sectionExtractedData}
                                                        word={word}
                                                        acceptableConfidence={acceptableConfidence}
                                                    />
                                                );
                                            })}
                                    </div>
                                </li>
                            </div>
                        );
                    } else {
                        return (
                            <div key={`${sectionName}_${sectionIndex}`}>
                                {sectionHeader && (
                                    <div className={styles.summaryListItemSubHeader}>{sectionHeader}</div>
                                )}
                                <li className={`${styles.summaryListItem} ${indent && styles.summaryListItemIndent}`}>
                                    <div
                                        contentEditable
                                        suppressContentEditableWarning
                                        ref={(el: HTMLDivElement | null) => (editableRefs.current[sectionIndex] = el)}
                                        onInput={() => handleInput(sectionIndex)}
                                        onClick={() => handleSegmentClick(SummarizedSegment, EvidenceLinks)}
                                        className={styles.summarizedSegment}
                                        style={summaryItemDivStyle}
                                    >
                                        {processSummarizedSegment(SummarizedSegment)}
                                    </div>
                                </li>
                            </div>
                        );
                    }
                })}
            </ul>
        );
    } else {
        return (
            <ul className={styles.summaryList}>
                <li className={styles.summaryListItem}>
                    <NoEntities
                        ref={(el: HTMLDivElement | null) => (editableRefs.current[0] = el)}
                        handleInput={() => handleEmptySectionInput(0)}
                        editableContent={emptySectionsContent[0]}
                    />
                </li>
            </ul>
        );
    }
}
