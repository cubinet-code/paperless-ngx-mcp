import axios, { AxiosResponse, ResponseType } from "axios";
import FormData from "form-data";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import {
  BulkEditDocumentsResult,
  BulkEditParameters,
  Correspondent,
  CustomField,
  Document,
  DocumentsResponse,
  DocumentType,
  GetCorrespondentsResponse,
  GetCustomFieldsResponse,
  GetDocumentTypesResponse,
  GetSavedViewsResponse,
  GetStoragePathsResponse,
  GetTagsResponse,
  SavedView,
  StoragePath,
  Tag,
} from "./types";
import { headersToObject } from "./utils";

const httpAgent = new HttpAgent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  timeout: 30000,
});
const httpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  timeout: 30000,
});

export const client = axios.create({
  timeout: 60000,
  httpAgent,
  httpsAgent,
});

export interface PostDocumentMetadata {
  title?: string;
  created?: string;
  correspondent?: number;
  document_type?: number;
  storage_path?: number;
  tags?: number[];
  archive_serial_number?: number;
  custom_fields?: number[];
}

export class PaperlessAPI {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api${path}`;
    const isJson = !options.body || typeof options.body === "string";

    const mergedHeaders = {
      Authorization: `Token ${this.token}`,
      Accept: "application/json; version=5",
      "Accept-Language": "en-US,en;q=0.9",
      ...(isJson ? { "Content-Type": "application/json" } : {}),
      ...headersToObject(options.headers),
    };

    try {
      const response = await client<T>({
        url,
        method: options.method || "GET",
        headers: mergedHeaders,
        data: options.body,
      });
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const responseData = error.response?.data as
          | Record<string, unknown>
          | undefined;
        const detail =
          responseData?.detail || responseData?.error || responseData?.message;
        const parts = [detail || error.message];
        if (status) parts.push(`(HTTP ${status})`);
        throw new Error(parts.join(" "));
      }
      throw error;
    }
  }

  async bulkEditDocuments(
    documents: number[],
    method: string,
    parameters: BulkEditParameters = {}
  ): Promise<BulkEditDocumentsResult> {
    return this.request<BulkEditDocumentsResult>("/documents/bulk_edit/", {
      method: "POST",
      body: JSON.stringify({
        documents,
        method,
        parameters,
      }),
    });
  }

  async postDocument(
    document: Buffer,
    filename: string,
    metadata: PostDocumentMetadata = {}
  ): Promise<string> {
    const formData = new FormData();
    formData.append("document", document, { filename });

    if (metadata.title) formData.append("title", metadata.title);
    if (metadata.created) formData.append("created", metadata.created);
    if (metadata.correspondent !== undefined)
      formData.append("correspondent", String(metadata.correspondent));
    if (metadata.document_type !== undefined)
      formData.append("document_type", String(metadata.document_type));
    if (metadata.storage_path !== undefined)
      formData.append("storage_path", String(metadata.storage_path));
    if (metadata.tags) {
      metadata.tags.forEach((tag) => formData.append("tags", String(tag)));
    }
    if (metadata.archive_serial_number !== undefined) {
      formData.append(
        "archive_serial_number",
        String(metadata.archive_serial_number)
      );
    }
    if (metadata.custom_fields) {
      metadata.custom_fields.forEach((field) =>
        formData.append("custom_fields", String(field))
      );
    }

    const response = await client.post<string>(
      `${this.baseUrl}/api/documents/post_document/`,
      formData,
      {
        headers: {
          Authorization: `Token ${this.token}`,
          ...formData.getHeaders(),
        },
      }
    );
    return response.data;
  }

  async getDocuments(query = ""): Promise<DocumentsResponse> {
    return this.request<DocumentsResponse>(`/documents/${query}`);
  }

  async getDocument(id: number): Promise<Document> {
    return this.request<Document>(`/documents/${id}/`);
  }

  async updateDocument(id: number, data: Partial<Document>): Promise<Document> {
    return this.request<Document>(`/documents/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteDocument(id: number): Promise<void> {
    return this.request<void>(`/documents/${id}/`, {
      method: "DELETE",
    });
  }

  async searchDocuments(query: string): Promise<DocumentsResponse> {
    return this.request<DocumentsResponse>(
      `/documents/?query=${encodeURIComponent(query)}`
    );
  }

  async downloadDocument(
    id: number,
    asOriginal = false
  ): Promise<AxiosResponse<ArrayBuffer>> {
    const query = asOriginal ? "?original=true" : "";
    const response = await client.get<ArrayBuffer>(
      `${this.baseUrl}/api/documents/${id}/download/${query}`,
      {
        headers: {
          Authorization: `Token ${this.token}`,
        },
        responseType: "arraybuffer",
      }
    );
    return response;
  }

  async getThumbnail(id: number): Promise<AxiosResponse<ArrayBuffer>> {
    const response = await client.get<ArrayBuffer>(
      `${this.baseUrl}/api/documents/${id}/thumb/`,
      {
        headers: {
          Authorization: `Token ${this.token}`,
        },
        responseType: "arraybuffer",
      }
    );
    return response;
  }

  async getTags(queryString?: string): Promise<GetTagsResponse> {
    const url = queryString ? `/tags/?${queryString}` : "/tags/";
    return this.request<GetTagsResponse>(url);
  }

  async createTag(data: Partial<Tag>): Promise<Tag> {
    return this.request<Tag>("/tags/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getTag(id: number): Promise<Tag> {
    return this.request<Tag>(`/tags/${id}/`);
  }

  async updateTag(id: number, data: Partial<Tag>): Promise<Tag> {
    return this.request<Tag>(`/tags/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteTag(id: number): Promise<void> {
    return this.request<void>(`/tags/${id}/`, {
      method: "DELETE",
    });
  }

  async getCorrespondents(
    queryString?: string
  ): Promise<GetCorrespondentsResponse> {
    const url = queryString
      ? `/correspondents/?${queryString}`
      : "/correspondents/";
    return this.request<GetCorrespondentsResponse>(url);
  }

  async getCorrespondent(id: number): Promise<Correspondent> {
    return this.request<Correspondent>(`/correspondents/${id}/`);
  }

  async createCorrespondent(
    data: Partial<Correspondent>
  ): Promise<Correspondent> {
    return this.request<Correspondent>("/correspondents/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCorrespondent(
    id: number,
    data: Partial<Correspondent>
  ): Promise<Correspondent> {
    return this.request<Correspondent>(`/correspondents/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteCorrespondent(id: number): Promise<void> {
    return this.request<void>(`/correspondents/${id}/`, {
      method: "DELETE",
    });
  }

  async getDocumentTypes(queryString?: string): Promise<GetDocumentTypesResponse> {
    const url = queryString ? `/document_types/?${queryString}` : "/document_types/";
    return this.request<GetDocumentTypesResponse>(url);
  }

  async createDocumentType(data: Partial<DocumentType>): Promise<DocumentType> {
    return this.request<DocumentType>("/document_types/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateDocumentType(
    id: number,
    data: Partial<DocumentType>
  ): Promise<DocumentType> {
    return this.request<DocumentType>(`/document_types/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteDocumentType(id: number): Promise<void> {
    return this.request<void>(`/document_types/${id}/`, {
      method: "DELETE",
    });
  }

  async getCustomFields(queryString?: string): Promise<GetCustomFieldsResponse> {
    const url = queryString ? `/custom_fields/?${queryString}` : "/custom_fields/";
    return this.request<GetCustomFieldsResponse>(url);
  }

  async getCustomField(id: number): Promise<CustomField> {
    return this.request<CustomField>(`/custom_fields/${id}/`);
  }

  async createCustomField(data: Partial<CustomField>): Promise<CustomField> {
    return this.request<CustomField>("/custom_fields/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCustomField(
    id: number,
    data: Partial<CustomField>
  ): Promise<CustomField> {
    return this.request<CustomField>(`/custom_fields/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteCustomField(id: number): Promise<void> {
    return this.request<void>(`/custom_fields/${id}/`, {
      method: "DELETE",
    });
  }

  async getStoragePaths(
    queryString?: string
  ): Promise<GetStoragePathsResponse> {
    const url = queryString
      ? `/storage_paths/?${queryString}`
      : "/storage_paths/";
    return this.request<GetStoragePathsResponse>(url);
  }

  async getStoragePath(id: number): Promise<StoragePath> {
    return this.request<StoragePath>(`/storage_paths/${id}/`);
  }

  async createStoragePath(
    data: Partial<StoragePath>
  ): Promise<StoragePath> {
    return this.request<StoragePath>("/storage_paths/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateStoragePath(
    id: number,
    data: Partial<StoragePath>
  ): Promise<StoragePath> {
    return this.request<StoragePath>(`/storage_paths/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteStoragePath(id: number): Promise<void> {
    return this.request<void>(`/storage_paths/${id}/`, {
      method: "DELETE",
    });
  }

  async getSavedViews(
    queryString?: string
  ): Promise<GetSavedViewsResponse> {
    const url = queryString
      ? `/saved_views/?${queryString}`
      : "/saved_views/";
    return this.request<GetSavedViewsResponse>(url);
  }

  async getSavedView(id: number): Promise<SavedView> {
    return this.request<SavedView>(`/saved_views/${id}/`);
  }

  async createSavedView(data: Partial<SavedView>): Promise<SavedView> {
    return this.request<SavedView>("/saved_views/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateSavedView(
    id: number,
    data: Partial<SavedView>
  ): Promise<SavedView> {
    return this.request<SavedView>(`/saved_views/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteSavedView(id: number): Promise<void> {
    return this.request<void>(`/saved_views/${id}/`, {
      method: "DELETE",
    });
  }

  async requestRaw<T = ArrayBuffer>(
    path: string,
    options: RequestInit & { responseType?: ResponseType } = {}
  ): Promise<AxiosResponse<T>> {
    const url = `${this.baseUrl}/api${path}`;
    try {
      const response = await client({
        url,
        method: (options.method as string) || "GET",
        headers: {
          Authorization: `Token ${this.token}`,
          "Content-Type": "application/json",
          Accept: "*/*",
          ...headersToObject(options.headers),
        },
        data: options.body,
        responseType: options.responseType ?? "arraybuffer",
      });
      return response as AxiosResponse<T>;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        throw new Error(
          `${error.message}${status ? ` (HTTP ${status})` : ""}`
        );
      }
      throw error;
    }
  }

  async bulkEditObjects(
    objects: number[],
    objectType: string,
    operation: string,
    parameters: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.request("/bulk_edit_objects/", {
      method: "POST",
      body: JSON.stringify({
        objects,
        object_type: objectType,
        operation,
        ...parameters,
      }),
    });
  }
}
