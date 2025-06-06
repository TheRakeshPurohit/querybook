import clsx from 'clsx';
import Resizable from 're-resizable';
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import toast from 'react-hot-toast';
import { useDispatch, useSelector } from 'react-redux';

import { AICommandBar } from 'components/AIAssistant/AICommandBar';
import { DataDocTableSamplingInfo } from 'components/DataDocTableSamplingInfo/DataDocTableSamplingInfo';
import { DataDocTemplateInfoButton } from 'components/DataDocTemplateButton/DataDocTemplateInfoButton';
import { DataDocTemplateVarForm } from 'components/DataDocTemplateButton/DataDocTemplateVarForm';
import { detectVariableType } from 'components/DataDocTemplateButton/helpers';
import { BoundQueryEditor } from 'components/QueryEditor/BoundQueryEditor';
import { IQueryEditorHandles } from 'components/QueryEditor/QueryEditor';
import { QueryPeerReviewModal } from 'components/QueryPeerReviewModal/QueryPeerReviewModal';
import {
    IQueryRunButtonHandles,
    QueryRunButton,
} from 'components/QueryRunButton/QueryRunButton';
import {
    ISearchAndReplaceHandles,
    ISearchAndReplaceProps,
    SearchAndReplace,
} from 'components/SearchAndReplace/SearchAndReplace';
import { TemplatedQueryView } from 'components/TemplateQueryView/TemplatedQueryView';
import { TranspileQueryModal } from 'components/TranspileQueryModal/TranspileQueryModal';
import { UDFForm } from 'components/UDFForm/UDFForm';
import { ComponentType, ElementType } from 'const/analytics';
import { IDataDocMetaVariable, IPeerReviewParams } from 'const/datadoc';
import KeyMap from 'const/keyMap';
import { IDataTable } from 'const/metastore';
import { IQueryEngine } from 'const/queryEngine';
import { ISearchOptions, ISearchResult } from 'const/searchAndReplace';
import { SurveySurfaceType } from 'const/survey';
import { useDebounceState } from 'hooks/redux/useDebounceState';
import { useSurveyTrigger } from 'hooks/ui/useSurveyTrigger';
import { useBrowserTitle } from 'hooks/useBrowserTitle';
import { useTrackView } from 'hooks/useTrackView';
import { trackClick } from 'lib/analytics';
import { replaceStringIndices, searchText } from 'lib/data-doc/search';
import { isAIFeatureEnabled } from 'lib/public-config';
import { DEFAULT_ROW_LIMIT } from 'lib/sql-helper/sql-limiter';
import { getPossibleTranspilers } from 'lib/templated-query/transpile';
import { enableResizable, getQueryEngineId, sleep } from 'lib/utils';
import { navigateWithinEnv } from 'lib/utils/query-string';
import { doesLanguageSupportUDF } from 'lib/utils/udf';
import * as adhocQueryActions from 'redux/adhocQuery/action';
import * as dataDocActions from 'redux/dataDoc/action';
import {
    queryEngineByIdEnvSelector,
    queryEngineSelector,
} from 'redux/queryEngine/selector';
import * as queryExecutionsAction from 'redux/queryExecutions/action';
import { Dispatch, IStoreState } from 'redux/store/types';
import { Button } from 'ui/Button/Button';
import { IconButton } from 'ui/Button/IconButton';
import { Dropdown } from 'ui/Dropdown/Dropdown';
import { FullHeight } from 'ui/FullHeight/FullHeight';
import { Level, LevelItem } from 'ui/Level/Level';
import { IListMenuItem, ListMenu } from 'ui/Menu/ListMenu';
import { Modal } from 'ui/Modal/Modal';
import { IResizableTextareaHandles } from 'ui/ResizableTextArea/ResizableTextArea';

import { QueryComposerExecution } from './QueryComposerExecution';
import { runQuery, transformQuery } from './RunQuery';

import './QueryComposer.scss';

const QUERY_EXECUTION_HEIGHT = 300;

const useExecution = (dispatch: Dispatch, environmentId: number) => {
    const executionId = useSelector(
        (state: IStoreState) => state.adhocQuery[environmentId]?.executionId
    );
    const setExecutionId = useCallback(
        (id: number) =>
            dispatch(
                adhocQueryActions.receiveAdhocQuery(
                    { executionId: id },
                    environmentId
                )
            ),
        []
    );

    return { executionId, setExecutionId };
};

const useEngine = (dispatch: Dispatch, environmentId: number) => {
    const engineId = useSelector(
        (state: IStoreState) => state.adhocQuery[environmentId]?.engineId
    );
    const queryEngineById = useSelector(queryEngineByIdEnvSelector);
    const queryEngines = useSelector(queryEngineSelector);
    const defaultEngineId = useSelector((state: IStoreState) =>
        getQueryEngineId(
            state.user.computedSettings['default_query_engine'],
            queryEngines.map(({ id }) => id)
        )
    );
    const setEngineId = useCallback(
        (id: number) =>
            dispatch(
                adhocQueryActions.receiveAdhocQuery(
                    { engineId: id },
                    environmentId
                )
            ),
        [environmentId, dispatch]
    );

    const actualEngineId =
        engineId != null && engineId in queryEngineById
            ? engineId
            : defaultEngineId;
    const engine = queryEngineById[actualEngineId];

    return {
        engine,
        setEngineId,
        queryEngines,
        queryEngineById,
    };
};

const useQuery = (dispatch: Dispatch, environmentId: number) => {
    const reduxQuery = useSelector(
        (state: IStoreState) => state.adhocQuery[environmentId]?.query ?? ''
    );
    const setReduxQuery = useCallback(
        (newQuery: string) =>
            dispatch(
                adhocQueryActions.receiveAdhocQuery(
                    { query: newQuery },
                    environmentId
                )
            ),
        [environmentId]
    );
    const [query, setQuery] = useDebounceState(reduxQuery, setReduxQuery, 500);
    return { query, setQuery };
};

const useRowLimit = (dispatch: Dispatch, environmentId: number) => {
    const rowLimit = useSelector(
        (state: IStoreState) =>
            state.adhocQuery[environmentId]?.rowLimit ?? DEFAULT_ROW_LIMIT
    );
    const setRowLimit = useCallback(
        (newRowLimit: number) =>
            dispatch(
                adhocQueryActions.receiveAdhocQuery(
                    { rowLimit: newRowLimit },
                    environmentId
                )
            ),
        [dispatch, environmentId]
    );

    return { rowLimit, setRowLimit };
};

const useTableSampleRate = (
    dispatch: Dispatch,
    environmentId: number,
    samplingTables: Record<string, any>
) => {
    const sampleRate = useSelector(
        (state: IStoreState) => state.adhocQuery[environmentId]?.sampleRate
    );
    const setSampleRate = useCallback(
        (newSampleRate: number) =>
            dispatch(
                adhocQueryActions.receiveAdhocQuery(
                    { sampleRate: newSampleRate },
                    environmentId
                )
            ),
        [dispatch, environmentId]
    );

    const getSampleRate = useCallback(
        () => (Object.keys(samplingTables).length > 0 ? sampleRate : -1),
        [sampleRate, samplingTables]
    );

    const getSamplingTables = useCallback(() => {
        Object.keys(samplingTables).forEach((tableName) => {
            samplingTables[tableName].sample_rate = getSampleRate();
        });
        return samplingTables;
    }, [getSampleRate, samplingTables]);

    return { setSampleRate, getSampleRate, getSamplingTables };
};

const useTemplatedVariables = (dispatch: Dispatch, environmentId: number) => {
    const reduxTemplatedVariables = useSelector(
        (state: IStoreState) =>
            state.adhocQuery[environmentId]?.templatedVariables
    );
    const templatedVariables = useMemo(() => {
        const templatedVariablesInState = reduxTemplatedVariables ?? [];
        if (!Array.isArray(templatedVariablesInState)) {
            // This whole block is only here for legacy reason
            // In the older version, we are storing it as a dictionary
            // so we need to convert to the new format
            const oldTemplatedVarConfig: Record<string, any> =
                templatedVariablesInState;
            const newConfig: IDataDocMetaVariable[] = [];
            Object.entries(oldTemplatedVarConfig).forEach(([key, value]) => {
                newConfig.push({
                    name: key,
                    value,
                    type: detectVariableType(value),
                });
            });
            return newConfig;
        }
        return templatedVariablesInState;
    }, [reduxTemplatedVariables]);

    const setTemplatedVariables = useCallback(
        (newVariables: IDataDocMetaVariable[]) =>
            dispatch(
                adhocQueryActions.receiveAdhocQuery(
                    { templatedVariables: newVariables },
                    environmentId
                )
            ),
        [environmentId]
    );

    return { templatedVariables, setTemplatedVariables };
};

const useQueryComposerSearchAndReplace = (
    query: string,
    setQuery: (s: string) => any
) => {
    const searchAndReplaceRef = useRef<ISearchAndReplaceHandles>(null);

    const getSearchResults = useCallback(
        (searchString: string, searchOptions: ISearchOptions) =>
            searchText(query, searchString, searchOptions),
        [query]
    );
    const replace = useCallback(
        (searchResultsToReplace: ISearchResult[], replaceString: string) => {
            setQuery(
                replaceStringIndices(
                    query,
                    searchResultsToReplace.map((r) => [r.from, r.to]),
                    replaceString
                )
            );
        },
        [query, setQuery]
    );

    const jumpToResult = useCallback(
        (_ignore: ISearchResult) => Promise.resolve(),
        []
    );

    useEffect(() => {
        searchAndReplaceRef.current?.performSearch();
    }, [query]);

    const searchAndReplaceProps: ISearchAndReplaceProps = {
        getSearchResults,
        replace,
        jumpToResult,
    };

    return {
        searchAndReplaceProps,
        searchAndReplaceRef,
    };
};

function useQueryEditorHelpers() {
    const queryEditorRef = useRef<IQueryEditorHandles>(null);
    const handleFormatQuery = useCallback(() => {
        trackClick({
            component: ComponentType.ADHOC_QUERY,
            element: ElementType.FORMAT_BUTTON,
        });
        if (queryEditorRef.current) {
            queryEditorRef.current.formatQuery();
        }
    }, []);

    const handleFocusEditor = useCallback(() => {
        queryEditorRef.current?.focus();
    }, []);

    useEffect(() => {
        handleFocusEditor();
    }, [handleFocusEditor]);

    return {
        queryEditorRef,
        handleFormatQuery,
    };
}

function useKeyMap(
    clickOnRunButton: () => void,
    queryEngines: IQueryEngine[],
    setEngineId: (id: number) => void
) {
    return useMemo(() => {
        const keyMap = {
            [KeyMap.codeEditor.runQuery.key]: clickOnRunButton,
        };

        for (const [index, engine] of queryEngines.entries()) {
            const key = index + 1;
            if (key > 9) {
                // We have exhausted all number keys on the keyboard
                break;
            }
            keyMap[KeyMap.codeEditor.changeEngine.key + '-' + String(key)] =
                () => setEngineId(engine.id);
        }

        return keyMap;
    }, [clickOnRunButton, queryEngines, setEngineId]);
}

function useTranspileQuery(
    currentQueryEngine: IQueryEngine,
    queryEngines: IQueryEngine[],
    setEngineId: (engineId: number) => any,
    setQuery: (query: string) => any
) {
    const [transpilerConfig, setTranspilerConfig] = useState<{
        transpilerName: string;
        toEngine: IQueryEngine;
    }>();

    const queryTranspilers = useSelector(
        (state: IStoreState) => state.queryEngine.queryTranspilers
    );

    const transpilerOptions = useMemo(
        () =>
            getPossibleTranspilers(
                queryTranspilers,
                currentQueryEngine,
                queryEngines
            ),
        [queryTranspilers, currentQueryEngine, queryEngines]
    );

    const startQueryTranspile = useCallback(
        (transpilerName: string, toEngine: IQueryEngine) => {
            setTranspilerConfig({ transpilerName, toEngine });
        },
        []
    );

    const clearQueryTranspile = useCallback(
        () => setTranspilerConfig(null),
        []
    );
    const handleTranspileQuery = useCallback(
        (query: string, engine: IQueryEngine) => {
            setQuery(query);
            setEngineId(engine.id);

            toast.success(`Query transpiled to ${engine.name}`);
            clearQueryTranspile();
        },
        [clearQueryTranspile, setQuery, setEngineId]
    );

    return {
        transpilerConfig,
        startQueryTranspile,
        clearQueryTranspile,
        handleTranspileQuery,
        transpilerOptions,
    };
}

function useUpdateAndRunQuery(
    setQuery: (query: string) => void,
    runQuery: () => void
) {
    const [shouldRunQuery, setShouldRunQuery] = useState<boolean>(false);

    useEffect(() => {
        if (shouldRunQuery) {
            runQuery();
            setShouldRunQuery(false);
        }
    }, [shouldRunQuery, runQuery]);

    return useCallback(
        (query: string, run?: boolean) => {
            setQuery(query);
            if (run) {
                setShouldRunQuery(true);
            }
        },
        [setQuery]
    );
}

const QueryComposer: React.FC = () => {
    useTrackView(ComponentType.ADHOC_QUERY);
    useBrowserTitle('Adhoc Query');

    const environmentId = useSelector(
        (state: IStoreState) => state.environment.currentEnvironmentId
    );
    const dispatch: Dispatch = useDispatch();
    const { query, setQuery } = useQuery(dispatch, environmentId);
    const { engine, setEngineId, queryEngines, queryEngineById } = useEngine(
        dispatch,
        environmentId
    );
    const { executionId, setExecutionId } = useExecution(
        dispatch,
        environmentId
    );
    const { rowLimit, setRowLimit } = useRowLimit(dispatch, environmentId);
    const [samplingTables, setSamplingTables] = useState({});
    const { setSampleRate, getSampleRate, getSamplingTables } =
        useTableSampleRate(dispatch, environmentId, samplingTables);
    const [resultsCollapsed, setResultsCollapsed] = useState(false);

    const { searchAndReplaceProps, searchAndReplaceRef } =
        useQueryComposerSearchAndReplace(query, setQuery);

    const canShowUDFForm = useMemo(
        () => doesLanguageSupportUDF(engine.language),
        [engine.language]
    );
    const [showUDFForm, setShowUDFForm] = useState(false);
    const [showTemplateForm, setShowTemplateForm] = useState(false);
    const { templatedVariables, setTemplatedVariables } = useTemplatedVariables(
        dispatch,
        environmentId
    );

    const [showRenderedTemplateModal, setShowRenderedTemplateModal] =
        useState(false);

    const [hasLintErrors, setHasLintErrors] = useState(false);

    const [showTableSamplingInfoModal, setShowTableSamplingInfoModal] =
        useState(false);

    const [tableNamesInQuery, setTableNamesInQuery] = useState<string[]>([]);
    const aiCommandInputRef = useRef<IResizableTextareaHandles>();

    const [showPeerReviewModal, setShowPeerReviewModal] = useState(false);
    const hasPeerReviewFeature = engine?.feature_params?.peer_review;

    const runButtonRef = useRef<IQueryRunButtonHandles>(null);
    const clickOnRunButton = useCallback(() => {
        if (runButtonRef.current) {
            runButtonRef.current.clickRunButton();
        }
    }, []);

    const { queryEditorRef, handleFormatQuery } = useQueryEditorHelpers();
    const hasQueryValidators = Boolean(engine?.feature_params?.validator);
    const {
        transpilerConfig,
        startQueryTranspile,
        clearQueryTranspile,
        handleTranspileQuery,
        transpilerOptions,
    } = useTranspileQuery(engine, queryEngines, setEngineId, setQuery);

    const handleCreateDataDoc = useCallback(async () => {
        trackClick({
            component: ComponentType.ADHOC_QUERY,
            element: ElementType.CREATE_DATADOC_BUTTON,
        });
        let dataDoc = null;
        const meta = { variables: templatedVariables };
        if (executionId) {
            dataDoc = await dispatch(
                dataDocActions.createDataDocFromAdhoc(
                    executionId,
                    engine.id,
                    query,
                    meta
                )
            );
        } else {
            const cell = {
                type: 'query',
                context: query,
                meta: { engine: engine.id },
            };
            dataDoc = await dispatch(
                dataDocActions.createDataDoc([cell], meta)
            );
        }
        navigateWithinEnv(`/datadoc/${dataDoc.id}/`);
    }, [executionId, query, engine.id, templatedVariables]);

    const getCurrentSelectedQuery = useCallback(
        () => queryEditorRef.current?.getSelection?.() ?? query,
        [queryEditorRef, query]
    );

    const triggerSurvey = useSurveyTrigger();

    const getQueryExecutionMetadata = useCallback(() => {
        const metadata = {};

        const sampleRate = getSampleRate();
        if (sampleRate > 0) {
            metadata['sample_rate'] = sampleRate;
        }

        return Object.keys(metadata).length === 0 ? null : metadata;
    }, [getSampleRate]);

    const handleRunQuery = useCallback(
        async (options?: {
            element?: ElementType;
            peerReviewParams?: IPeerReviewParams;
            onSuccess?: (queryId: number) => void;
        }) => {
            const {
                element = ElementType.RUN_QUERY_BUTTON,
                peerReviewParams,
                onSuccess,
            } = options ?? {};

            const sampleRate = getSampleRate();
            const samplingTables = getSamplingTables();
            const queryExecutionMetadata = getQueryExecutionMetadata();

            trackClick({
                component: ComponentType.ADHOC_QUERY,
                element,
                aux: {
                    lintError: hasLintErrors,
                    sampleRate,
                },
            });

            // Throttle to prevent double run
            await sleep(250);

            const transformedQuery = await transformQuery(
                getCurrentSelectedQuery(),
                engine.language,
                templatedVariables,
                engine,
                rowLimit,
                samplingTables,
                sampleRate
            );

            const queryId = await runQuery(
                transformedQuery,
                engine.id,
                async (query, engineId) => {
                    const data = await dispatch(
                        queryExecutionsAction.createQueryExecution(
                            query,
                            engineId,
                            null,
                            queryExecutionMetadata,
                            peerReviewParams
                        )
                    );
                    return data.id;
                }
            );

            triggerSurvey(SurveySurfaceType.QUERY_AUTHORING, {
                query_execution_id: queryId,
            });

            if (queryId != null) {
                setExecutionId(queryId);
                setResultsCollapsed(false);
                onSuccess?.(queryId);
            }
            return queryId;
        },
        [
            getSampleRate,
            getSamplingTables,
            getQueryExecutionMetadata,
            hasLintErrors,
            getCurrentSelectedQuery,
            engine,
            templatedVariables,
            rowLimit,
            triggerSurvey,
            dispatch,
            setExecutionId,
        ]
    );

    const onPeerReviewSubmit = useCallback(
        async (peerReviewParams: IPeerReviewParams) => {
            setShowPeerReviewModal(false);
            return handleRunQuery({
                element: ElementType.PEER_REVIEW_QUERY_BUTTON,
                peerReviewParams,
            });
        },
        [handleRunQuery, setShowPeerReviewModal]
    );

    const updateAndRunQuery = useUpdateAndRunQuery(setQuery, handleRunQuery);

    const keyMap = useKeyMap(clickOnRunButton, queryEngines, setEngineId);

    const [editorHasSelection, setEditorHasSelection] = useState(false);
    const handleEditorSelection = React.useCallback((hasSelection: boolean) => {
        setEditorHasSelection(hasSelection);
    }, []);

    const scrollToCollapseExecution = React.useCallback(
        (event, direction, elementRef) => {
            if (
                direction === 'top' &&
                elementRef.clientHeight < QUERY_EXECUTION_HEIGHT / 3
            ) {
                setResultsCollapsed(true);
            }
        },
        []
    );

    const handleTablesChange = React.useCallback(
        async (tablesByName: Record<string, IDataTable>) => {
            const samplingTables = {};
            Object.keys(tablesByName).forEach((tableName) => {
                const table = tablesByName[tableName];
                if (table?.custom_properties?.sampling) {
                    samplingTables[tableName] = {
                        sampled_table: table.custom_properties?.sampled_table,
                    };
                }
            });
            setSamplingTables(samplingTables);
            setTableNamesInQuery(Object.keys(tablesByName));
        },
        [setSamplingTables]
    );

    const handleOnFocus = React.useCallback(() => {
        trackClick({
            component: ComponentType.ADHOC_QUERY,
            element: ElementType.QUERY_EDITOR,
            aux: {
                action: 'focus',
                environmentId,
                query,
            },
        });
    }, [environmentId, query]);

    const handleOnBlur = React.useCallback(() => {
        trackClick({
            component: ComponentType.ADHOC_QUERY,
            element: ElementType.QUERY_EDITOR,
            aux: {
                action: 'blur',
                environmentId,
                query,
            },
        });
    }, [environmentId, query]);

    const editorDOM = (
        <>
            <BoundQueryEditor
                ref={queryEditorRef}
                value={query}
                lineWrapping={true}
                onChange={setQuery}
                keyMap={keyMap}
                height="full"
                engine={engine}
                hasQueryLint={hasQueryValidators}
                onFocus={handleOnFocus}
                onBlur={handleOnBlur}
                onSelection={handleEditorSelection}
                onLintCompletion={setHasLintErrors}
                onTablesChange={handleTablesChange}
                templatedVariables={templatedVariables}
            />
        </>
    );

    const executionDOM = () => {
        if (!executionId) {
            return null;
        } else if (resultsCollapsed) {
            const collapseButton = (
                <div
                    className="flex-center"
                    onClick={() => setResultsCollapsed(false)}
                    aria-label="Show Query Execution"
                    data-balloon-pos="top"
                >
                    <IconButton icon="ChevronUp" noPadding />
                </div>
            );
            return collapseButton;
        }

        return (
            <Resizable
                defaultSize={{
                    width: '100%',
                    height: `${QUERY_EXECUTION_HEIGHT}px`,
                }}
                enable={enableResizable({ top: true, bottom: true })}
                onResize={scrollToCollapseExecution}
            >
                <div className="query-execution-wrapper">
                    <div
                        className="hide-execution flex-center pt8 mb4"
                        onClick={() => setResultsCollapsed(true)}
                        aria-label="Collapse Query Execution"
                        data-balloon-pos="bottom"
                    >
                        <IconButton icon="ChevronDown" noPadding />
                    </div>
                    <QueryComposerExecution
                        id={executionId}
                        onSamplingInfoClick={() =>
                            setShowTableSamplingInfoModal(true)
                        }
                        hasSamplingTables={
                            Object.keys(samplingTables).length > 0
                        }
                        sampleRate={getSampleRate()}
                        onUpdateQuery={updateAndRunQuery}
                    />
                </div>
            </Resizable>
        );
    };

    const udfModalDOM = showUDFForm && (
        <Modal
            title="Insert User Defined Function"
            onHide={() => setShowUDFForm(false)}
        >
            <UDFForm
                onConfirm={(udfScript) => {
                    setQuery(udfScript + '\n\n' + query);
                    setShowUDFForm(false);
                    toast('UDF Added!');
                }}
                engineLanguage={engine.language}
            />
        </Modal>
    );

    const renderTableSamplingInfoDOM = showTableSamplingInfoModal && (
        <DataDocTableSamplingInfo
            query={getCurrentSelectedQuery()}
            language={engine.language}
            samplingTables={getSamplingTables()}
            onHide={() => setShowTableSamplingInfoModal(false)}
        />
    );

    const queryEditorWrapperClassname = clsx({
        'query-editor-wrapper': true,
        mb16: executionId != null,
    });

    const contentDOM = (
        <div className="QueryComposer-content-editor">
            <div className={queryEditorWrapperClassname}>
                <SearchAndReplace
                    ref={searchAndReplaceRef}
                    {...searchAndReplaceProps}
                >
                    {editorDOM}
                </SearchAndReplace>
            </div>
            {executionDOM()}
            {udfModalDOM}
            {renderTableSamplingInfoDOM}
        </div>
    );

    const queryRunDOM = (
        <div>
            <QueryRunButton
                ref={runButtonRef}
                queryEngineById={queryEngineById}
                queryEngines={queryEngines}
                engineId={engine?.id}
                onEngineIdSelect={setEngineId}
                onRunClick={handleRunQuery}
                hasSelection={editorHasSelection}
                runButtonTooltipPos={'down'}
                rowLimit={rowLimit}
                onRowLimitChange={setRowLimit}
                hasSamplingTables={Object.keys(samplingTables).length > 0}
                sampleRate={getSampleRate()}
                onSampleRateChange={setSampleRate}
                onTableSamplingInfoClick={() =>
                    setShowTableSamplingInfoModal(true)
                }
            />
        </div>
    );

    const templatedModalDOM = showTemplateForm && (
        <Modal
            onHide={() => {
                setShowTemplateForm(false);
            }}
            title="Variables"
            topDOM={<DataDocTemplateInfoButton />}
        >
            <DataDocTemplateVarForm
                isEditable={true}
                variables={templatedVariables}
                onSave={async (newVariables) => {
                    setTemplatedVariables(newVariables);
                    setShowTemplateForm(false);
                    toast.success('Variables saved!');
                }}
            />
        </Modal>
    );

    const templatedQueryViewModalDOM = showRenderedTemplateModal && (
        <Modal
            onHide={() => setShowRenderedTemplateModal(false)}
            title="Rendered Templated Query"
        >
            <TemplatedQueryView
                query={query}
                templatedVariables={templatedVariables}
                engineId={engine.id}
                onRunQueryClick={() => {
                    setShowRenderedTemplateModal(false);
                    handleRunQuery();
                }}
                hasValidator={hasQueryValidators}
            />
        </Modal>
    );

    const peerReviewModalDOM = showPeerReviewModal && (
        <QueryPeerReviewModal
            onSubmit={onPeerReviewSubmit}
            onHide={() => setShowPeerReviewModal(false)}
        />
    );

    const getAdditionalDropDownButtonDOM = () => {
        const additionalButtons: IListMenuItem[] = [
            {
                name: 'Template Config',
                onClick: () => {
                    trackClick({
                        component: ComponentType.ADHOC_QUERY,
                        element: ElementType.TEMPLATE_CONFIG_BUTTON,
                    });
                    setShowTemplateForm(true);
                },
                icon: 'Code',
                tooltip: 'Set Variables',
                tooltipPos: 'right',
            },
            {
                name: 'Render Template',
                onClick: () => {
                    trackClick({
                        component: ComponentType.ADHOC_QUERY,
                        element: ElementType.RENDER_QUERY_BUTTON,
                    });
                    setShowRenderedTemplateModal(true);
                },
                icon: 'Eye',
                tooltip: 'Show the rendered templated query',
                tooltipPos: 'right',
            },
            {
                name: 'Create DataDoc',
                onClick: handleCreateDataDoc,
                icon: 'Plus',
                tooltip: 'Create datadoc from the adhoc query',
                tooltipPos: 'right',
            },
        ];

        if (transpilerOptions.length > 0) {
            additionalButtons.push({
                name: `Transpile Query`,
                icon: 'Languages',

                items: transpilerOptions.map((t) => ({
                    name: `To ${t.toEngine.name} (${t.toEngine.language})`,
                    onClick: () =>
                        startQueryTranspile(t.transpilerName, t.toEngine),
                })),
            });
        }

        if (canShowUDFForm) {
            additionalButtons.push({
                name: 'Add UDF',
                onClick: () => setShowUDFForm(true),
                icon: 'Plus',
                tooltip: 'Add New User Defined Function',
                tooltipPos: 'right',
            });
        }

        if (hasPeerReviewFeature) {
            additionalButtons.push({
                name: 'Request Query Review',
                onClick: () => setShowPeerReviewModal(true),
                icon: 'Send',
                tooltip: 'Request a peer review for your query',
                tooltipPos: 'right',
            });
        }

        return (
            <>
                <Dropdown
                    menuIcon="MoreVertical"
                    className="query-cell-additional-dropdown"
                >
                    <ListMenu items={additionalButtons} isNestedRight={true} />
                </Dropdown>
                {templatedModalDOM}
                {templatedQueryViewModalDOM}
                {peerReviewModalDOM}
            </>
        );
    };

    const headerDOM = (
        <div className="QueryComposer-header">
            <div className="QueryComposer-header-vertical">
                <Level>
                    <LevelItem>
                        <Button
                            icon="Edit3"
                            title="Format"
                            onClick={handleFormatQuery}
                            theme="text"
                        />
                        <Button
                            icon="Delete"
                            title="Clear"
                            onClick={() => {
                                trackClick({
                                    component: ComponentType.ADHOC_QUERY,
                                    element: ElementType.CLEAR_BUTTON,
                                });
                                setQuery('');
                                setExecutionId(null);
                            }}
                            theme="text"
                        />
                        {getAdditionalDropDownButtonDOM()}
                    </LevelItem>
                    <LevelItem>{queryRunDOM}</LevelItem>
                </Level>
            </div>
        </div>
    );

    const aiDOM = isAIFeatureEnabled() && (
        <div className="mv8">
            <AICommandBar
                query={query}
                queryEngine={queryEngineById[engine.id]}
                tablesInQuery={tableNamesInQuery}
                onUpdateQuery={setQuery}
                onFormatQuery={handleFormatQuery}
                ref={aiCommandInputRef}
            />
        </div>
    );

    const transpilerDOM = transpilerConfig ? (
        <TranspileQueryModal
            query={query}
            fromEngine={engine}
            toEngine={transpilerConfig.toEngine}
            onHide={clearQueryTranspile}
            onTranspileConfirm={handleTranspileQuery}
            transpilerName={transpilerConfig.transpilerName}
        />
    ) : null;

    return (
        <FullHeight flex={'column'} className="QueryComposer">
            {headerDOM}
            {aiDOM}
            {contentDOM}
            {transpilerDOM}
        </FullHeight>
    );
};

export default QueryComposer;
