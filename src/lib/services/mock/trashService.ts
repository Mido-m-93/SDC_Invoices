import type { ITrashService } from "../types";
import type { TrashedItem } from "@/types";
import {
  loadTrash,
  addToTrash,
  removeFromTrash,
  clearTrash,
} from "./fileStore";

export class MockTrashService implements ITrashService {
  async listTrashed(): Promise<TrashedItem[]> {
    return loadTrash();
  }

  async addToTrash(item: TrashedItem): Promise<void> {
    addToTrash(item);
  }

  async removeFromTrash(trashId: string): Promise<TrashedItem | undefined> {
    return removeFromTrash(trashId);
  }

  async clearTrash(): Promise<void> {
    clearTrash();
  }
}
