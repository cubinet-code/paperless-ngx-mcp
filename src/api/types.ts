export const MATCHING_ALGORITHM_OPTIONS = {
  0: "None",
  1: "Any word",
  2: "All words",
  3: "Exact match",
  4: "Regular expression",
  5: "Fuzzy word",
  6: "Automatic",
} as const;

export type MatchingAlgorithm = keyof typeof MATCHING_ALGORITHM_OPTIONS;

export const MATCHING_ALGORITHM_DESCRIPTION = `Matching algorithm: ${Object.entries(
  MATCHING_ALGORITHM_OPTIONS
)
  .map(([id, name]) => `${id}=${name}`)
  .join(", ")}`;

export interface Tag {
  id: number;
  slug: string;
  name: string;
  color: string;
  text_color: string;
  match: string;
  matching_algorithm: number;
  is_insensitive: boolean;
  is_inbox_tag: boolean;
  document_count: number;
  owner: number | null;
  user_can_change: boolean;
}

export interface CustomField {
  id: number;
  name: string;
  data_type: string;
  extra_data?: Record<string, unknown> | null;
  document_count: number;
}

export interface CustomFieldInstance {
  field: number;
  value: string | number | boolean | object | null;
}

export interface PaginationResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  all: number[];
  results: T[];
}

export interface GetTagsResponse extends PaginationResponse<Tag> {}

export interface GetCustomFieldsResponse
  extends PaginationResponse<CustomField> {}

export interface BasicUser {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
}

export interface Note {
  id: number;
  note: string;
  created: string;
  user: BasicUser;
}

export interface DocumentsResponse extends PaginationResponse<Document> {}

export interface Document {
  id: number;
  correspondent: number | null;
  document_type: number | null;
  storage_path: string | null;
  title: string;
  content: string | null;
  tags: number[];
  created: string;
  created_date: string;
  modified: string;
  added: string;
  deleted_at: string | null;
  archive_serial_number: string | null;
  original_file_name: string;
  archived_file_name: string;
  owner: number | null;
  user_can_change: boolean;
  is_shared_by_requester: boolean;
  notes: Note[];
  custom_fields: CustomFieldInstance[];
  page_count: number;
  mime_type: string;
  __search_hit__?: SearchHit;
}

export interface SearchHit {
  score: number;
  highlights: string;
  note_highlights: string;
  rank: number;
}

export interface Correspondent {
  id: number;
  slug: string;
  name: string;
  match: string;
  matching_algorithm: number;
  is_insensitive: boolean;
  document_count: number;
  last_correspondence: string;
  owner: number | null;
  permissions: Record<string, unknown>;
  user_can_change: boolean;
}

export interface GetCorrespondentsResponse
  extends PaginationResponse<Correspondent> {}

export interface DocumentType {
  id: number;
  slug: string;
  name: string;
  match: string;
  matching_algorithm: number;
  is_insensitive: boolean;
  document_count: number;
  last_correspondence: string;
  owner: number | null;
  permissions: Record<string, unknown>;
  user_can_change: boolean;
}

export interface GetDocumentTypesResponse
  extends PaginationResponse<DocumentType> {}

export interface StoragePath {
  id: number;
  slug: string;
  name: string;
  path: string;
  match: string;
  matching_algorithm: number;
  is_insensitive: boolean;
  document_count: number;
  owner: number | null;
  user_can_change: boolean;
}

export interface GetStoragePathsResponse
  extends PaginationResponse<StoragePath> {}

export interface SavedViewFilterRule {
  rule_type: number;
  value: string;
}

export interface SavedView {
  id: number;
  name: string;
  show_on_dashboard: boolean;
  show_in_sidebar: boolean;
  sort_field: string;
  sort_reverse: boolean;
  filter_rules: SavedViewFilterRule[];
  owner: number | null;
  user_can_change: boolean;
}

export interface GetSavedViewsResponse
  extends PaginationResponse<SavedView> {}

export interface BulkEditDocumentsResult {
  result: string;
}

export interface BulkEditPdfOperation {
  page: number;
  rotate?: number;
  doc?: number;
}

export interface BulkEditParameters {
  // modify_custom_fields — wire shape per upstream BulkEditSerializer:
  // dict {field_id: value} OR list [field_id, ...] for assignments.
  add_custom_fields?: Record<string, unknown> | number[];
  remove_custom_fields?: number[];

  add_tags?: number[];
  remove_tags?: number[];
  tag?: number;

  correspondent?: number;
  document_type?: number;
  storage_path?: number;

  degrees?: number;
  pages?: string;
  metadata_document_id?: number;
  delete_originals?: boolean;

  // set_permissions, owner, merge are siblings at parameters root, not nested.
  set_permissions?: {
    view: { users?: number[]; groups?: number[] };
    change: { users?: number[]; groups?: number[] };
  };
  owner?: number | null;
  merge?: boolean;

  operations?: BulkEditPdfOperation[];
  update_document?: boolean;
  include_metadata?: boolean;
}
