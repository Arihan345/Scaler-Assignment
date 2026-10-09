"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { keys } from "./query";
import type { ConversationDetail, ConversationListItem, User } from "./types";

export const useConversationList = (archived = false, requests = false) =>
  useQuery({
    queryKey: keys.conversations(archived, requests),
    queryFn: () => api.get<ConversationListItem[]>(`/conversations?archived=${archived}&requests=${requests}`),
  });

export const useConversation = (id: string) =>
  useQuery({ queryKey: keys.conversation(id), queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`), retry: false });

export const useContacts = () => useQuery({ queryKey: keys.contacts, queryFn: () => api.get<User[]>("/contacts") });

export function useUserSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: keys.search(term),
    queryFn: () => api.get<User[]>(`/users/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 10_000,
  });
}

export function useBlocked() {
  return useQuery({ queryKey: keys.blocked, queryFn: () => api.get<User[]>("/blocks") });
}
