import { CallToolResult } from "@modelcontextprotocol/sdk/types";
import { PaperlessAPI } from "./PaperlessAPI";
import { CustomFieldInstance, Document, DocumentsResponse } from "./types";
import { NamedItem } from "./utils";

export interface EnhancedCustomField extends CustomFieldInstance {
  name: string;
}

export interface EnhancedDocument
  extends Omit<
    Document,
    "correspondent" | "document_type" | "tags" | "custom_fields" | "content" | "notes"
  > {
  correspondent: NamedItem | null;
  document_type: NamedItem | null;
  tags: NamedItem[];
  custom_fields: EnhancedCustomField[];
}

export async function convertDocsWithNames(
  document: Document,
  api: PaperlessAPI
): Promise<CallToolResult>;
export async function convertDocsWithNames(
  documentsResponse: DocumentsResponse,
  api: PaperlessAPI
): Promise<CallToolResult>;
export async function convertDocsWithNames(
  input: Document | DocumentsResponse,
  api: PaperlessAPI
): Promise<CallToolResult> {
  if ("results" in input) {
    const enhancedResults = await enhanceDocumentsArray(
      input.results || [],
      api
    );

    return {
      content: [
        {
          type: "text",
          text: enhancedResults.length
            ? JSON.stringify({
                ...input,
                results: enhancedResults,
              })
            : "No documents found",
        },
      ],
    };
  }

  const [enhanced] = await enhanceDocumentsArray([input], api);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(enhanced),
      },
    ],
  };
}

async function enhanceDocumentsArray(
  documents: Document[],
  api: PaperlessAPI
): Promise<EnhancedDocument[]> {
  if (!documents.length) {
    return [];
  }

  const needsCorrespondents = documents.some((d) => d.correspondent !== null);
  const needsDocumentTypes = documents.some((d) => d.document_type !== null);
  const needsTags = documents.some((d) => d.tags.length > 0);
  const needsCustomFields = documents.some((d) => d.custom_fields.length > 0);

  const emptyMap = <K, V>() => new Map<K, V>();
  const buildMap = <T extends { id: number; name: string }>(
    response: { results: T[] } | { results?: T[] }
  ) =>
    new Map<number, string>(
      (response.results ?? []).map((item) => [item.id, item.name])
    );

  const [correspondentMap, documentTypeMap, tagMap, customFieldMap] =
    await Promise.all([
      needsCorrespondents
        ? api.getCorrespondents("page_size=10000").then(buildMap)
        : emptyMap<number, string>(),
      needsDocumentTypes
        ? api.getDocumentTypes("page_size=10000").then(buildMap)
        : emptyMap<number, string>(),
      needsTags
        ? api.getTags("page_size=10000").then(buildMap)
        : emptyMap<number, string>(),
      needsCustomFields
        ? api.getCustomFields("page_size=10000").then(buildMap)
        : emptyMap<number, string>(),
    ]);

  return documents.map((doc) => {
    const { content, notes, ...slim } = doc;
    return {
      ...slim,
      correspondent: doc.correspondent
        ? {
            id: doc.correspondent,
            name:
              correspondentMap.get(doc.correspondent) ||
              String(doc.correspondent),
          }
        : null,
      document_type: doc.document_type
        ? {
            id: doc.document_type,
            name:
              documentTypeMap.get(doc.document_type) ||
              String(doc.document_type),
          }
        : null,
      tags: doc.tags.map((tagId) => ({
        id: tagId,
        name: tagMap.get(tagId) || String(tagId),
      })),
      custom_fields: doc.custom_fields.map((field) => ({
        field: field.field,
        name: customFieldMap.get(field.field) || String(field.field),
        value: field.value,
      })),
    };
  });
}
