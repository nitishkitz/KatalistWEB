export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      actors: {
        Row: {
          created_at: string
          external_identity_id: string | null
          id: string
          kind: Database["public"]["Enums"]["actor_kind"]
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_identity_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["actor_kind"]
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_identity_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["actor_kind"]
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "actors_external_identity_id_fkey"
            columns: ["external_identity_id"]
            isOneToOne: false
            referencedRelation: "external_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          created_at: string
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      bridge_grants: {
        Row: {
          actor_id: string
          assignment_id: string
          created_at: string
          expires_at: string
          first_used_at: string | null
          id: string
          issued_by_actor_id: string
          revoked_at: string | null
          revoked_reason: string | null
          thing_id: string
          token_hash: string
        }
        Insert: {
          actor_id: string
          assignment_id: string
          created_at?: string
          expires_at: string
          first_used_at?: string | null
          id?: string
          issued_by_actor_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          thing_id: string
          token_hash: string
        }
        Update: {
          actor_id?: string
          assignment_id?: string
          created_at?: string
          expires_at?: string
          first_used_at?: string | null
          id?: string
          issued_by_actor_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          thing_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_grants_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_grants_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "thing_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_grants_issued_by_actor_id_fkey"
            columns: ["issued_by_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_grants_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "bridge_grants_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_sessions: {
        Row: {
          created_at: string
          expires_at: string
          grant_id: string
          id: string
          last_seen_at: string
          revoked_at: string | null
          session_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          grant_id: string
          id?: string
          last_seen_at?: string
          revoked_at?: string | null
          session_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          grant_id?: string
          id?: string
          last_seen_at?: string
          revoked_at?: string | null
          session_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_sessions_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "bridge_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      bucket_items: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          list_id: string | null
          position: number | null
          thing_id: string | null
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id?: string
          list_id?: string | null
          position?: number | null
          thing_id?: string | null
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          list_id?: string | null
          position?: number | null
          thing_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bucket_items_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bucket_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bucket_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["list_id"]
          },
          {
            foreignKeyName: "bucket_items_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "bucket_items_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
        ]
      }
      buckets: {
        Row: {
          archived_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          id: string
          name: string
          owner_profile_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at?: string
          id?: string
          name: string
          owner_profile_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          context?: Database["public"]["Enums"]["context_kind"]
          created_at?: string
          id?: string
          name?: string
          owner_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buckets_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          actor_id: string | null
          alias: string | null
          created_at: string
          email: string | null
          id: string
          owner_profile_id: string
          phone_e164: string | null
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          alias?: string | null
          created_at?: string
          email?: string | null
          id?: string
          owner_profile_id: string
          phone_e164?: string | null
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          alias?: string | null
          created_at?: string
          email?: string | null
          id?: string
          owner_profile_id?: string
          phone_e164?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      doorman_state: {
        Row: {
          breakthrough_reason: string | null
          created_at: string
          dismissed_at: string | null
          id: string
          last_presented_at: string | null
          profile_id: string
          snoozed_until: string | null
          thing_id: string
          updated_at: string
        }
        Insert: {
          breakthrough_reason?: string | null
          created_at?: string
          dismissed_at?: string | null
          id?: string
          last_presented_at?: string | null
          profile_id: string
          snoozed_until?: string | null
          thing_id: string
          updated_at?: string
        }
        Update: {
          breakthrough_reason?: string | null
          created_at?: string
          dismissed_at?: string | null
          id?: string
          last_presented_at?: string | null
          profile_id?: string
          snoozed_until?: string | null
          thing_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doorman_state_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doorman_state_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "doorman_state_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
        ]
      }
      external_identities: {
        Row: {
          claimed_at: string | null
          claimed_profile_id: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          phone_e164: string | null
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_profile_id?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          phone_e164?: string | null
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_profile_id?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          phone_e164?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_identities_claimed_profile_id_fkey"
            columns: ["claimed_profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_members: {
        Row: {
          added_by_profile_id: string | null
          created_at: string
          id: string
          list_id: string
          profile_id: string
          role: Database["public"]["Enums"]["list_role"]
          updated_at: string
        }
        Insert: {
          added_by_profile_id?: string | null
          created_at?: string
          id?: string
          list_id: string
          profile_id: string
          role?: Database["public"]["Enums"]["list_role"]
          updated_at?: string
        }
        Update: {
          added_by_profile_id?: string | null
          created_at?: string
          id?: string
          list_id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["list_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_members_added_by_profile_id_fkey"
            columns: ["added_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["list_id"]
          },
          {
            foreignKeyName: "list_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      list_messages: {
        Row: {
          author_profile_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          list_id: string
          updated_at: string
        }
        Insert: {
          author_profile_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          list_id: string
          updated_at?: string
        }
        Update: {
          author_profile_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          list_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_messages_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_messages_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_messages_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["list_id"]
          },
        ]
      }
      lists: {
        Row: {
          archived_at: string | null
          cover_storage_path: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          description: string | null
          id: string
          name: string
          owner_profile_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cover_storage_path?: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_profile_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cover_storage_path?: string | null
          context?: Database["public"]["Enums"]["context_kind"]
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lists_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          list_id: string | null
          payload: Json
          profile_id: string
          read_at: string | null
          thing_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          list_id?: string | null
          payload?: Json
          profile_id: string
          read_at?: string | null
          thing_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          list_id?: string | null
          payload?: Json
          profile_id?: string
          read_at?: string | null
          thing_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["list_id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "notifications_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
        ]
      }
      nudges: {
        Row: {
          created_at: string
          from_actor_id: string
          id: string
          message: string | null
          reason: Database["public"]["Enums"]["nudge_reason"]
          thing_id: string
          to_actor_id: string
        }
        Insert: {
          created_at?: string
          from_actor_id: string
          id?: string
          message?: string | null
          reason: Database["public"]["Enums"]["nudge_reason"]
          thing_id: string
          to_actor_id: string
        }
        Update: {
          created_at?: string
          from_actor_id?: string
          id?: string
          message?: string | null
          reason?: Database["public"]["Enums"]["nudge_reason"]
          thing_id?: string
          to_actor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nudges_from_actor_id_fkey"
            columns: ["from_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nudges_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "nudges_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nudges_to_actor_id_fkey"
            columns: ["to_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
        ]
      }
      private_activity: {
        Row: {
          created_at: string
          detail: Json
          event: Database["public"]["Enums"]["private_activity_event"]
          id: string
          object_id: string
          object_type: Database["public"]["Enums"]["object_type"]
          profile_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          event: Database["public"]["Enums"]["private_activity_event"]
          id?: string
          object_id: string
          object_type: Database["public"]["Enums"]["object_type"]
          profile_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          event?: Database["public"]["Enums"]["private_activity_event"]
          id?: string
          object_id?: string
          object_type?: Database["public"]["Enums"]["object_type"]
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_activity_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_object_state: {
        Row: {
          created_at: string
          id: string
          object_id: string
          object_type: Database["public"]["Enums"]["object_type"]
          profile_id: string
          shredded_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          object_id: string
          object_type: Database["public"]["Enums"]["object_type"]
          profile_id: string
          shredded_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          object_id?: string
          object_type?: Database["public"]["Enums"]["object_type"]
          profile_id?: string
          shredded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_object_state_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_context: Database["public"]["Enums"]["context_kind"]
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string | null
          id: string
          phone_e164: string | null
          timezone: string
          updated_at: string
          age: number | null
          occupation: string | null
        }
        Insert: {
          active_context?: Database["public"]["Enums"]["context_kind"]
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id: string
          phone_e164?: string | null
          timezone?: string
          updated_at?: string
          age?: number | null
          occupation?: string | null
        }
        Update: {
          active_context?: Database["public"]["Enums"]["context_kind"]
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          phone_e164?: string | null
          timezone?: string
          updated_at?: string
          age?: number | null
          occupation?: string | null
        }
        Relationships: []
      }
      thing_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          event: Database["public"]["Enums"]["activity_event"]
          id: string
          thing_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event: Database["public"]["Enums"]["activity_event"]
          id?: string
          thing_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event?: Database["public"]["Enums"]["activity_event"]
          id?: string
          thing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thing_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thing_activity_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "thing_activity_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
        ]
      }
      thing_assignments: {
        Row: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assigned_at: string
          assigned_by_actor_id: string
          assignee_actor_id: string
          caught_at: string | null
          ended_at: string | null
          ended_reason: string | null
          id: string
          thing_id: string
        }
        Insert: {
          acknowledgement?: Database["public"]["Enums"]["acknowledgement_state"]
          assigned_at?: string
          assigned_by_actor_id: string
          assignee_actor_id: string
          caught_at?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          thing_id: string
        }
        Update: {
          acknowledgement?: Database["public"]["Enums"]["acknowledgement_state"]
          assigned_at?: string
          assigned_by_actor_id?: string
          assignee_actor_id?: string
          caught_at?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          thing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thing_assignments_assigned_by_actor_id_fkey"
            columns: ["assigned_by_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thing_assignments_assignee_actor_id_fkey"
            columns: ["assignee_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thing_assignments_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "thing_assignments_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
        ]
      }
      thing_comments: {
        Row: {
          author_actor_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          thing_id: string
          updated_at: string
        }
        Insert: {
          author_actor_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          thing_id: string
          updated_at?: string
        }
        Update: {
          author_actor_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          thing_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "thing_comments_author_actor_id_fkey"
            columns: ["author_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thing_comments_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "thing_comments_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
        ]
      }
      thing_attachments: {
        Row: {
          byte_size: number
          client_id: string
          created_at: string
          file_name: string
          finalized_at: string | null
          id: string
          mime_type: string
          staging_key: string
          status: string
          storage_key: string | null
          thing_id: string
          uploaded_by_actor_id: string
        }
        Insert: {
          byte_size: number
          client_id: string
          created_at?: string
          file_name: string
          finalized_at?: string | null
          id?: string
          mime_type: string
          staging_key: string
          status?: string
          storage_key?: string | null
          thing_id: string
          uploaded_by_actor_id: string
        }
        Update: {
          byte_size?: number
          client_id?: string
          created_at?: string
          file_name?: string
          finalized_at?: string | null
          id?: string
          mime_type?: string
          staging_key?: string
          status?: string
          storage_key?: string | null
          thing_id?: string
          uploaded_by_actor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thing_attachments_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["thing_id"]
          },
          {
            foreignKeyName: "thing_attachments_thing_id_fkey"
            columns: ["thing_id"]
            isOneToOne: false
            referencedRelation: "things"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thing_attachments_uploaded_by_actor_id_fkey"
            columns: ["uploaded_by_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
        ]
      }
      things: {
        Row: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        Insert: {
          acknowledgement?: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace?: Database["public"]["Enums"]["pace"] | null
          cancelled_at?: string | null
          caught_at?: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at?: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id?: string | null
          due_at?: string | null
          due_has_time?: boolean
          id?: string
          list_id?: string | null
          notes?: string | null
          owner_actor_id: string
          owner_importance?: Database["public"]["Enums"]["importance"]
          sorted_at?: string | null
          title: string
          updated_at?: string
          work_status?: Database["public"]["Enums"]["work_status"]
        }
        Update: {
          acknowledgement?: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace?: Database["public"]["Enums"]["pace"] | null
          cancelled_at?: string | null
          caught_at?: string | null
          context?: Database["public"]["Enums"]["context_kind"]
          created_at?: string
          creator_actor_id?: string
          current_assignee_actor_id?: string
          current_assignment_id?: string | null
          due_at?: string | null
          due_has_time?: boolean
          id?: string
          list_id?: string | null
          notes?: string | null
          owner_actor_id?: string
          owner_importance?: Database["public"]["Enums"]["importance"]
          sorted_at?: string | null
          title?: string
          updated_at?: string
          work_status?: Database["public"]["Enums"]["work_status"]
        }
        Relationships: [
          {
            foreignKeyName: "things_creator_actor_id_fkey"
            columns: ["creator_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "things_current_assignee_actor_id_fkey"
            columns: ["current_assignee_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "things_current_assignment_fk"
            columns: ["current_assignment_id"]
            isOneToOne: false
            referencedRelation: "thing_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "things_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "things_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "thing_list_label"
            referencedColumns: ["list_id"]
          },
          {
            foreignKeyName: "things_owner_actor_id_fkey"
            columns: ["owner_actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_identities: {
        Row: {
          id: string | null
          display_name: string | null
          avatar_url: string | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          id: string | null
          email: string | null
          display_name: string | null
          avatar_url: string | null
        }
        Relationships: []
      }
      thing_list_label: {
        Row: {
          list_context: Database["public"]["Enums"]["context_kind"] | null
          list_id: string | null
          list_name: string | null
          thing_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_connected_list_member: {
        Args: { p_list_id: string; p_profile_id: string; p_role?: Database["public"]["Enums"]["list_role"] }
        Returns: Database["public"]["Tables"]["list_members"]["Row"]
      }
      create_list_v2: {
        Args: { p_name: string; p_context?: Database["public"]["Enums"]["context_kind"]; p_description?: string }
        Returns: Database["public"]["Tables"]["lists"]["Row"]
      }
      create_list_invitation_server: {
        Args: { p_requester_profile_id: string; p_list_id: string; p_invitee_profile_id: string | null; p_phone_hash: string; p_token_hash: string; p_role: Database["public"]["Enums"]["list_role"]; p_expires_at: string }
        Returns: string
      }
      accept_list_invitation_server: {
        Args: { p_token_hash: string; p_accepting_profile_id: string }
        Returns: string
      }
      list_list_roster: {
        Args: { p_list_id: string }
        Returns: { profile_id: string; display_name: string; avatar_url: string | null; role: string; is_owner: boolean }[]
      }
      list_team_directory: {
        Args: Record<PropertyKey, never>
        Returns: { profile_id: string; display_name: string; avatar_url: string | null; phone_e164: string | null }[]
      }
      request_team_connection: {
        Args: { p_recipient_profile_id: string }
        Returns: string
      }
      accept_team_request: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      list_team_requests: {
        Args: Record<PropertyKey, never>
        Returns: { request_id: string; direction: string; profile_id: string; display_name: string; avatar_url: string | null; created_at: string }[]
      }
      remove_team_connection: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      list_team_invitations: {
        Args: Record<PropertyKey, never>
        Returns: { invitation_id: string; phone_last4: string; created_at: string; expires_at: string }[]
      }
      create_team_invitation_server: {
        Args: { p_requester_profile_id: string; p_phone_hash: string; p_phone_last4: string; p_token_hash: string; p_expires_at: string }
        Returns: string
      }
      accept_team_invitation_server: {
        Args: { p_token_hash: string; p_accepting_profile_id: string }
        Returns: boolean
      }
      add_list_member: {
        Args: {
          p_list_id: string
          p_profile_id: string
          p_role?: Database["public"]["Enums"]["list_role"]
        }
        Returns: {
          added_by_profile_id: string | null
          created_at: string
          id: string
          list_id: string
          profile_id: string
          role: Database["public"]["Enums"]["list_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "list_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_to_bucket: {
        Args: { p_bucket_id: string; p_list_id?: string; p_thing_id?: string }
        Returns: {
          bucket_id: string
          created_at: string
          id: string
          list_id: string | null
          position: number | null
          thing_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bucket_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_thing: {
        Args: { p_assignee_actor_id: string; p_thing_id: string }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_outside_katalist: {
        Args: {
          p_display_name: string
          p_email?: string
          p_phone_e164?: string
          p_thing_id: string
        }
        Returns: {
          actor_id: string
          expires_at: string
          token: string
        }[]
      }
      bridge_act: {
        Args: { p_action: string; p_session_token: string }
        Returns: Database["public"]["Enums"]["work_status"]
      }
      bridge_comment: {
        Args: { p_body: string; p_session_token: string }
        Returns: string
      }
      bridge_get_thing: {
        Args: { p_session_token: string }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          due_at: string
          due_has_time: boolean
          id: string
          notes: string
          owner_importance: Database["public"]["Enums"]["importance"]
          owner_name: string
          title: string
          work_status: Database["public"]["Enums"]["work_status"]
        }[]
      }
      bridge_redeem_token: {
        Args: { p_token: string }
        Returns: {
          expires_at: string
          session_token: string
          thing_id: string
        }[]
      }
      cancel_thing: {
        Args: { p_reason?: string; p_thing_id: string }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      catch_thing: {
        Args: {
          p_personal_pace?: Database["public"]["Enums"]["pace"]
          p_thing_id: string
        }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_list_role: {
        Args: {
          p_list_id: string
          p_profile_id: string
          p_role: Database["public"]["Enums"]["list_role"]
        }
        Returns: {
          added_by_profile_id: string | null
          created_at: string
          id: string
          list_id: string
          profile_id: string
          role: Database["public"]["Enums"]["list_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "list_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_external_identity: {
        Args: { p_phone_e164: string }
        Returns: string
      }
      claim_notification_deliveries: {
        Args: { p_lease_seconds: number; p_limit: number }
        Returns: {
          attempt_count: number
          body: string | null
          delivery_id: string
          fcm_token: string
          kind: string
          list_id: string | null
          notification_id: string
          subscription_id: string
          thing_id: string | null
          title: string
        }[]
      }
      consume_uat_auth_rate_limit: {
        Args: { p_limit: number; p_scope_hash: string; p_window_seconds: number }
        Returns: boolean
      }
      consume_magic_box_ai_budget: {
        Args: { p_operation: string; p_user_id: string }
        Returns: boolean
      }
      create_bucket: {
        Args: {
          p_context?: Database["public"]["Enums"]["context_kind"]
          p_name: string
        }
        Returns: {
          archived_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          id: string
          name: string
          owner_profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_bucket: {
        Args: { p_bucket_id: string }
        Returns: boolean
      }
      create_external_actor: {
        Args: {
          p_display_name: string
          p_email?: string
          p_phone_e164?: string
        }
        Returns: {
          created_at: string
          external_identity_id: string | null
          id: string
          kind: Database["public"]["Enums"]["actor_kind"]
          profile_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "actors"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_list: {
        Args: {
          p_context?: Database["public"]["Enums"]["context_kind"]
          p_name: string
        }
        Returns: {
          archived_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          id: string
          name: string
          owner_profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lists"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_thing: {
        Args: {
          p_assignee_actor_id?: string
          p_context?: Database["public"]["Enums"]["context_kind"]
          p_due_at?: string
          p_due_has_time?: boolean
          p_list_id?: string
          p_notes?: string
          p_owner_importance?: Database["public"]["Enums"]["importance"]
          p_personal_pace?: Database["public"]["Enums"]["pace"]
          p_title: string
        }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dismiss_breakthrough: {
        Args: { p_thing_id: string }
        Returns: {
          breakthrough_reason: string | null
          created_at: string
          dismissed_at: string | null
          id: string
          last_presented_at: string | null
          profile_id: string
          snoozed_until: string | null
          thing_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "doorman_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      abandon_pending_attachment: {
        Args: { p_client_id: string; p_staging_key: string; p_thing_id: string }
        Returns: boolean
      }
      complete_thing_attachment: {
        Args: { p_attachment_id: string; p_storage_key: string }
        Returns: {
          byte_size: number
          client_id: string
          created_at: string
          file_name: string
          finalized_at: string | null
          id: string
          mime_type: string
          staging_key: string
          status: string
          storage_key: string | null
          thing_id: string
          uploaded_by_actor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "thing_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_thing_attachments: {
        Args: { p_thing_id: string }
        Returns: {
          byte_size: number
          client_id: string
          created_at: string
          file_name: string
          finalized_at: string | null
          id: string
          mime_type: string
          staging_key: string
          status: string
          storage_key: string | null
          thing_id: string
          uploaded_by_actor_id: string
        }[]
      }
      list_stale_pending_attachments: {
        Args: { p_older_than?: string }
        Returns: { id: string; staging_key: string }[]
      }
      reserve_thing_attachment: {
        Args: {
          p_client_id: string
          p_file_name: string
          p_staging_key: string
          p_thing_id: string
        }
        Returns: {
          byte_size: number
          client_id: string
          created_at: string
          file_name: string
          finalized_at: string | null
          id: string
          mime_type: string
          staging_key: string
          status: string
          storage_key: string | null
          thing_id: string
          uploaded_by_actor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "thing_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      doorman_mark_presented: {
        Args: { p_reason?: string; p_thing_id: string }
        Returns: {
          breakthrough_reason: string | null
          created_at: string
          dismissed_at: string | null
          id: string
          last_presented_at: string | null
          profile_id: string
          snoozed_until: string | null
          thing_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "doorman_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_notification_delivery: {
        Args: {
          p_delivery_id: string
          p_error_code?: string | null
          p_error_detail?: string | null
          p_fcm_message_id?: string | null
          p_next_attempt_at?: string | null
          p_result: string
          p_revoke?: boolean
        }
        Returns: boolean
      }
      get_thing_list_label: {
        Args: { p_thing_id: string }
        Returns: {
          list_context: Database["public"]["Enums"]["context_kind"]
          list_id: string
          list_name: string
        }[]
      }
      issue_bridge_grant: {
        Args: { p_thing_id: string }
        Returns: {
          expires_at: string
          grant_id: string
          token: string
        }[]
      }
      list_bridge_grants: {
        Args: { p_thing_id: string }
        Returns: {
          actor_id: string
          created_at: string
          expires_at: string
          first_used_at: string
          id: string
          revoked_at: string
          revoked_reason: string
        }[]
      }
      list_assignable_people: {
        Args: never
        Returns: {
          actor_id: string
          avatar_url: string | null
          display_name: string
        }[]
      }
      list_visible_profile_identities: {
        Args: never
        Returns: {
          id: string
          display_name: string | null
          avatar_url: string | null
        }[]
      }
      list_nudgeable_things: {
        Args: never
        Returns: {
          reason: Database["public"]["Enums"]["nudge_reason"]
          since: string
          thing_id: string
          title: string
          to_actor_id: string
        }[]
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: {
          actor_id: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          list_id: string | null
          payload: Json
          profile_id: string
          read_at: string | null
          thing_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notification_delivery_status: {
        Args: { p_notification_id: string }
        Returns: {
          delivery_id: string
          fcm_message_id: string | null
          status: string
        }[]
      }
      nudge_thing: {
        Args: {
          p_message?: string
          p_reason?: Database["public"]["Enums"]["nudge_reason"]
          p_thing_id: string
        }
        Returns: {
          created_at: string
          from_actor_id: string
          id: string
          message: string | null
          reason: Database["public"]["Enums"]["nudge_reason"]
          thing_id: string
          to_actor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "nudges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      promote_thing_person_to_list: {
        Args: {
          p_list_id: string
          p_role?: Database["public"]["Enums"]["list_role"]
          p_thing_id: string
        }
        Returns: {
          added_by_profile_id: string | null
          created_at: string
          id: string
          list_id: string
          profile_id: string
          role: Database["public"]["Enums"]["list_role"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "list_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_push_subscription: {
        Args: { p_fcm_token: string; p_profile_id: string; p_user_agent?: string | null }
        Returns: string
      }
      reassign_thing: {
        Args: { p_new_assignee_actor_id: string; p_thing_id: string }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_from_bucket: {
        Args: { p_bucket_id: string; p_list_id?: string; p_thing_id?: string }
        Returns: boolean
      }
      remove_list_member: {
        Args: { p_list_id: string; p_profile_id: string }
        Returns: boolean
      }
      rename_bucket: {
        Args: { p_bucket_id: string; p_name: string }
        Returns: {
          archived_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          id: string
          name: string
          owner_profile_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "buckets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_actor_identities: {
        Args: {
          p_actor_ids: string[]
        }
        Returns: {
          actor_id: string
          display_name: string | null
          avatar_url: string | null
        }[]
      }
      resolve_profile_identities: {
        Args: {
          p_profile_ids: string[]
        }
        Returns: {
          id: string
          display_name: string | null
          avatar_url: string | null
        }[]
      }
      restore_for_me: {
        Args: {
          p_object_id: string
          p_object_type: Database["public"]["Enums"]["object_type"]
        }
        Returns: {
          created_at: string
          id: string
          object_id: string
          object_type: Database["public"]["Enums"]["object_type"]
          profile_id: string
          shredded_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_object_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_bridge_grant: { Args: { p_grant_id: string }; Returns: boolean }
      revoke_push_subscription: {
        Args: { p_fcm_token: string; p_profile_id: string }
        Returns: boolean
      }
      run_backend_tests: {
        Args: never
        Returns: {
          detail: string
          ok: boolean
          test: string
        }[]
      }
      set_due: {
        Args: { p_due_at: string; p_due_has_time?: boolean; p_thing_id: string }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_owner_importance: {
        Args: {
          p_owner_importance: Database["public"]["Enums"]["importance"]
          p_thing_id: string
        }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_personal_pace: {
        Args: {
          p_personal_pace: Database["public"]["Enums"]["pace"]
          p_thing_id: string
        }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_work_status: {
        Args: {
          p_thing_id: string
          p_work_status: Database["public"]["Enums"]["work_status"]
        }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shred_for_me: {
        Args: {
          p_object_id: string
          p_object_type: Database["public"]["Enums"]["object_type"]
        }
        Returns: {
          created_at: string
          id: string
          object_id: string
          object_type: Database["public"]["Enums"]["object_type"]
          profile_id: string
          shredded_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_object_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      snooze_breakthrough: {
        Args: { p_snoozed_until?: string; p_thing_id: string }
        Returns: {
          breakthrough_reason: string | null
          created_at: string
          dismissed_at: string | null
          id: string
          last_presented_at: string | null
          profile_id: string
          snoozed_until: string | null
          thing_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "doorman_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sort_thing: {
        Args: { p_thing_id: string }
        Returns: {
          acknowledgement: Database["public"]["Enums"]["acknowledgement_state"]
          assignee_personal_pace: Database["public"]["Enums"]["pace"] | null
          cancelled_at: string | null
          caught_at: string | null
          context: Database["public"]["Enums"]["context_kind"]
          created_at: string
          creator_actor_id: string
          current_assignee_actor_id: string
          current_assignment_id: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          list_id: string | null
          notes: string | null
          owner_actor_id: string
          owner_importance: Database["public"]["Enums"]["importance"]
          sorted_at: string | null
          title: string
          updated_at: string
          work_status: Database["public"]["Enums"]["work_status"]
        }
        SetofOptions: {
          from: "*"
          to: "things"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      test_bridge_cleanup: { Args: never; Returns: undefined }
      test_bridge_fixture: {
        Args: never
        Returns: {
          ext_actor: string
          list_id: string
          other_actor: string
          other_profile: string
          other_thing_id: string
          owner_profile: string
          thing_id: string
          token: string
        }[]
      }
      test_bridge_owner: {
        Args: {
          p_action: string
          p_profile: string
          p_target?: string
          p_thing_id: string
        }
        Returns: string
      }
      test_bridge_state: { Args: { p_thing_id: string }; Returns: Json }
      unread_notification_count: { Args: never; Returns: number }
    }
    Enums: {
      acknowledgement_state: "waiting_for_catch" | "caught"
      activity_event:
        | "created"
        | "assigned"
        | "caught"
        | "work_status_changed"
        | "importance_changed"
        | "due_changed"
        | "reassigned"
        | "nudged"
        | "commented"
        | "sorted"
        | "cancelled"
        | "promoted_to_list"
        | "bridge_opened"
        | "bridge_revoked"
      actor_kind: "user" | "external"
      context_kind: "work" | "home"
      delivery_status: "pending" | "sent" | "failed" | "skipped"
      importance: "now" | "next" | "later"
      list_role: "collaborator" | "view_only"
      notification_channel: "in_app" | "push" | "email" | "whatsapp" | "sms"
      nudge_reason:
        | "waiting_for_catch"
        | "quiet"
        | "due_soon"
        | "stale"
        | "repeated_handoff"
      object_type: "thing" | "list" | "bucket"
      pace: "now" | "next" | "later"
      private_activity_event:
        | "bucket_ref_added"
        | "bucket_ref_removed"
        | "shredded"
        | "restored"
        | "breakthrough_snoozed"
        | "breakthrough_dismissed"
      work_status: "not_started" | "under_progress" | "sorted" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      acknowledgement_state: ["waiting_for_catch", "caught"],
      activity_event: [
        "created",
        "assigned",
        "caught",
        "work_status_changed",
        "importance_changed",
        "due_changed",
        "reassigned",
        "nudged",
        "commented",
        "sorted",
        "cancelled",
        "promoted_to_list",
        "bridge_opened",
        "bridge_revoked",
      ],
      actor_kind: ["user", "external"],
      context_kind: ["work", "home"],
      delivery_status: ["pending", "sent", "failed", "skipped"],
      importance: ["now", "next", "later"],
      list_role: ["collaborator", "view_only"],
      notification_channel: ["in_app", "push", "email", "whatsapp", "sms"],
      nudge_reason: [
        "waiting_for_catch",
        "quiet",
        "due_soon",
        "stale",
        "repeated_handoff",
      ],
      object_type: ["thing", "list", "bucket"],
      pace: ["now", "next", "later"],
      private_activity_event: [
        "bucket_ref_added",
        "bucket_ref_removed",
        "shredded",
        "restored",
        "breakthrough_snoozed",
        "breakthrough_dismissed",
      ],
      work_status: ["not_started", "under_progress", "sorted", "cancelled"],
    },
  },
} as const
