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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agency_sla_defaults: {
        Row: {
          active_window_days: number
          after_hours_mode: string
          attempts_24h: number
          attempts_7d: number
          business_hours_only: boolean
          critical_stale_after_hours: number
          first_response_seconds: number
          id: boolean
          stale_after_hours: number
          updated_at: string
        }
        Insert: {
          active_window_days?: number
          after_hours_mode?: string
          attempts_24h?: number
          attempts_7d?: number
          business_hours_only?: boolean
          critical_stale_after_hours?: number
          first_response_seconds?: number
          id?: boolean
          stale_after_hours?: number
          updated_at?: string
        }
        Update: {
          active_window_days?: number
          after_hours_mode?: string
          attempts_24h?: number
          attempts_7d?: number
          business_hours_only?: boolean
          critical_stale_after_hours?: number
          first_response_seconds?: number
          id?: boolean
          stale_after_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      budget_accounts: {
        Row: {
          campaign_label: string | null
          created_at: string
          id: string
          monthly_budget: number
          notes: string | null
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          campaign_label?: string | null
          created_at?: string
          id?: string
          monthly_budget?: number
          notes?: string | null
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          campaign_label?: string | null
          created_at?: string
          id?: string
          monthly_budget?: number
          notes?: string | null
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_accounts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_budgets: {
        Row: {
          campaign: string
          daily_budget: number
          id: string
          property_id: string
          status: string | null
          synced_at: string
        }
        Insert: {
          campaign: string
          daily_budget?: number
          id?: string
          property_id: string
          status?: string | null
          synced_at?: string
        }
        Update: {
          campaign?: string
          daily_budget?: number
          id?: string
          property_id?: string
          status?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_budgets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_labels: {
        Row: {
          campaign: string
          label_name: string
          property_id: string
          synced_at: string
        }
        Insert: {
          campaign: string
          label_name: string
          property_id: string
          synced_at?: string
        }
        Update: {
          campaign?: string
          label_name?: string
          property_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_labels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ctm_calls: {
        Row: {
          ad_group: string | null
          call_score_bucket: string | null
          call_score_label: string | null
          called_at: string
          caller_number: string | null
          campaign_name: string | null
          channel: string | null
          ctm_call_id: string
          duration_seconds: number | null
          id: string
          property_id: string
          raw_payload: Json | null
          synced_at: string
          tracking_source: string | null
        }
        Insert: {
          ad_group?: string | null
          call_score_bucket?: string | null
          call_score_label?: string | null
          called_at: string
          caller_number?: string | null
          campaign_name?: string | null
          channel?: string | null
          ctm_call_id: string
          duration_seconds?: number | null
          id?: string
          property_id: string
          raw_payload?: Json | null
          synced_at?: string
          tracking_source?: string | null
        }
        Update: {
          ad_group?: string | null
          call_score_bucket?: string | null
          call_score_label?: string | null
          called_at?: string
          caller_number?: string | null
          campaign_name?: string | null
          channel?: string | null
          ctm_call_id?: string
          duration_seconds?: number | null
          id?: string
          property_id?: string
          raw_payload?: Json | null
          synced_at?: string
          tracking_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ctm_calls_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_metrics: {
        Row: {
          ad_source: string
          admissions: number
          bad_leads: number
          campaign: string
          clicks: number
          cost: number
          created_at: string
          date: string
          good_leads: number
          id: string
          impressions: number
          leads: number
          medicaid: number
          no_entry: number
          property_id: string
          record_count: number
          sessions: number
          spam: number
          users: number
        }
        Insert: {
          ad_source: string
          admissions?: number
          bad_leads?: number
          campaign: string
          clicks?: number
          cost?: number
          created_at?: string
          date: string
          good_leads?: number
          id?: string
          impressions?: number
          leads?: number
          medicaid?: number
          no_entry?: number
          property_id: string
          record_count?: number
          sessions?: number
          spam?: number
          users?: number
        }
        Update: {
          ad_source?: string
          admissions?: number
          bad_leads?: number
          campaign?: string
          clicks?: number
          cost?: number
          created_at?: string
          date?: string
          good_leads?: number
          id?: string
          impressions?: number
          leads?: number
          medicaid?: number
          no_entry?: number
          property_id?: string
          record_count?: number
          sessions?: number
          spam?: number
          users?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_appointments: {
        Row: {
          appointment_status: Database["public"]["Enums"]["ghl_appointment_status"]
          appointment_status_raw: string | null
          assigned_user_id: string | null
          calendar_id: string | null
          contact_id: string | null
          created_at: string
          ends_at: string | null
          ghl_event_id: string
          id: string
          opportunity_id: string | null
          property_id: string
          raw: Json | null
          starts_at: string | null
          status_is_derived: boolean
          updated_at: string
        }
        Insert: {
          appointment_status?: Database["public"]["Enums"]["ghl_appointment_status"]
          appointment_status_raw?: string | null
          assigned_user_id?: string | null
          calendar_id?: string | null
          contact_id?: string | null
          created_at?: string
          ends_at?: string | null
          ghl_event_id: string
          id?: string
          opportunity_id?: string | null
          property_id: string
          raw?: Json | null
          starts_at?: string | null
          status_is_derived?: boolean
          updated_at?: string
        }
        Update: {
          appointment_status?: Database["public"]["Enums"]["ghl_appointment_status"]
          appointment_status_raw?: string | null
          assigned_user_id?: string | null
          calendar_id?: string | null
          contact_id?: string | null
          created_at?: string
          ends_at?: string | null
          ghl_event_id?: string
          id?: string
          opportunity_id?: string | null
          property_id?: string
          raw?: Json | null
          starts_at?: string | null
          status_is_derived?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_appointments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_contacts: {
        Row: {
          assigned_to: string | null
          assigned_user_id: string | null
          created_at: string
          duplicate_group_id: string | null
          email: string | null
          first_human_response_at: string | null
          first_name: string | null
          first_response_at: string | null
          ghl_contact_id: string
          ghl_created_at: string | null
          ghl_location_id: string
          has_opportunity: boolean
          id: string
          last_name: string | null
          latest_human_response_at: string | null
          latest_opportunity_id: string | null
          phone: string | null
          pipeline_stage: string | null
          property_id: string
          raw: Json
          source: string | null
          speed_to_lead_seconds: number | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          assigned_user_id?: string | null
          created_at?: string
          duplicate_group_id?: string | null
          email?: string | null
          first_human_response_at?: string | null
          first_name?: string | null
          first_response_at?: string | null
          ghl_contact_id: string
          ghl_created_at?: string | null
          ghl_location_id: string
          has_opportunity?: boolean
          id?: string
          last_name?: string | null
          latest_human_response_at?: string | null
          latest_opportunity_id?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          property_id: string
          raw?: Json
          source?: string | null
          speed_to_lead_seconds?: number | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          assigned_user_id?: string | null
          created_at?: string
          duplicate_group_id?: string | null
          email?: string | null
          first_human_response_at?: string | null
          first_name?: string | null
          first_response_at?: string | null
          ghl_contact_id?: string
          ghl_created_at?: string | null
          ghl_location_id?: string
          has_opportunity?: boolean
          id?: string
          last_name?: string | null
          latest_human_response_at?: string | null
          latest_opportunity_id?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          property_id?: string
          raw?: Json
          source?: string | null
          speed_to_lead_seconds?: number | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_events_raw: {
        Row: {
          ghl_location_id: string
          ghl_object_id: string
          id: string
          ingested_at: string
          object_type: string
          occurred_at: string | null
          property_id: string
          raw: Json
        }
        Insert: {
          ghl_location_id: string
          ghl_object_id: string
          id?: string
          ingested_at?: string
          object_type: string
          occurred_at?: string | null
          property_id: string
          raw: Json
        }
        Update: {
          ghl_location_id?: string
          ghl_object_id?: string
          id?: string
          ingested_at?: string
          object_type?: string
          occurred_at?: string | null
          property_id?: string
          raw?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ghl_events_raw_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_lead_facts: {
        Row: {
          ai_touch_count: number
          appointment_booked_at: string | null
          appointment_no_show_at: string | null
          appointment_showed_at: string | null
          assigned_user_id: string | null
          automation_touch_count: number
          canonical_stage:
            | Database["public"]["Enums"]["ghl_canonical_stage"]
            | null
          contact_id: string
          created_at: string
          first_ai_response_at: string | null
          first_any_response_at: string | null
          first_automation_response_at: string | null
          first_human_response_at: string | null
          first_human_response_channel: string | null
          human_attempt_count: number
          human_speed_to_lead_seconds_business: number | null
          human_speed_to_lead_seconds_raw: number | null
          id: string
          is_open: boolean
          is_stale: boolean
          last_activity_at: string | null
          last_human_activity_at: string | null
          lead_created_at: string
          lost_at: string | null
          lost_reason_normalized: string | null
          lost_reason_raw: string | null
          monetary_value: number | null
          opportunity_id: string | null
          pipeline_id: string | null
          property_id: string
          stage_id: string | null
          total_touch_count: number
          updated_at: string
          won_at: string | null
        }
        Insert: {
          ai_touch_count?: number
          appointment_booked_at?: string | null
          appointment_no_show_at?: string | null
          appointment_showed_at?: string | null
          assigned_user_id?: string | null
          automation_touch_count?: number
          canonical_stage?:
            | Database["public"]["Enums"]["ghl_canonical_stage"]
            | null
          contact_id: string
          created_at?: string
          first_ai_response_at?: string | null
          first_any_response_at?: string | null
          first_automation_response_at?: string | null
          first_human_response_at?: string | null
          first_human_response_channel?: string | null
          human_attempt_count?: number
          human_speed_to_lead_seconds_business?: number | null
          human_speed_to_lead_seconds_raw?: number | null
          id?: string
          is_open?: boolean
          is_stale?: boolean
          last_activity_at?: string | null
          last_human_activity_at?: string | null
          lead_created_at: string
          lost_at?: string | null
          lost_reason_normalized?: string | null
          lost_reason_raw?: string | null
          monetary_value?: number | null
          opportunity_id?: string | null
          pipeline_id?: string | null
          property_id: string
          stage_id?: string | null
          total_touch_count?: number
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          ai_touch_count?: number
          appointment_booked_at?: string | null
          appointment_no_show_at?: string | null
          appointment_showed_at?: string | null
          assigned_user_id?: string | null
          automation_touch_count?: number
          canonical_stage?:
            | Database["public"]["Enums"]["ghl_canonical_stage"]
            | null
          contact_id?: string
          created_at?: string
          first_ai_response_at?: string | null
          first_any_response_at?: string | null
          first_automation_response_at?: string | null
          first_human_response_at?: string | null
          first_human_response_channel?: string | null
          human_attempt_count?: number
          human_speed_to_lead_seconds_business?: number | null
          human_speed_to_lead_seconds_raw?: number | null
          id?: string
          is_open?: boolean
          is_stale?: boolean
          last_activity_at?: string | null
          last_human_activity_at?: string | null
          lead_created_at?: string
          lost_at?: string | null
          lost_reason_normalized?: string | null
          lost_reason_raw?: string | null
          monetary_value?: number | null
          opportunity_id?: string | null
          pipeline_id?: string | null
          property_id?: string
          stage_id?: string | null
          total_touch_count?: number
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_lead_facts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_messages: {
        Row: {
          body_preview: string | null
          channel: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string | null
          ghl_message_id: string
          ghl_user_id: string | null
          id: string
          message_type: string | null
          meta: Json | null
          property_id: string
          raw: Json | null
          response_source: Database["public"]["Enums"]["ghl_response_source"]
          sent_at: string | null
          source_raw: string | null
          updated_at: string
        }
        Insert: {
          body_preview?: string | null
          channel?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          ghl_message_id: string
          ghl_user_id?: string | null
          id?: string
          message_type?: string | null
          meta?: Json | null
          property_id: string
          raw?: Json | null
          response_source?: Database["public"]["Enums"]["ghl_response_source"]
          sent_at?: string | null
          source_raw?: string | null
          updated_at?: string
        }
        Update: {
          body_preview?: string | null
          channel?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          ghl_message_id?: string
          ghl_user_id?: string | null
          id?: string
          message_type?: string | null
          meta?: Json | null
          property_id?: string
          raw?: Json | null
          response_source?: Database["public"]["Enums"]["ghl_response_source"]
          sent_at?: string | null
          source_raw?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_messages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_opportunities: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          created_at: string
          ghl_created_at: string | null
          ghl_opportunity_id: string
          ghl_updated_at: string | null
          id: string
          lost_at: string | null
          lost_reason_normalized: string | null
          lost_reason_raw: string | null
          monetary_value: number | null
          pipeline_id: string | null
          property_id: string
          raw: Json | null
          stage_id: string | null
          status: Database["public"]["Enums"]["ghl_opportunity_status"]
          status_raw: string | null
          updated_at: string
          won_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          ghl_created_at?: string | null
          ghl_opportunity_id: string
          ghl_updated_at?: string | null
          id?: string
          lost_at?: string | null
          lost_reason_normalized?: string | null
          lost_reason_raw?: string | null
          monetary_value?: number | null
          pipeline_id?: string | null
          property_id: string
          raw?: Json | null
          stage_id?: string | null
          status?: Database["public"]["Enums"]["ghl_opportunity_status"]
          status_raw?: string | null
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          ghl_created_at?: string | null
          ghl_opportunity_id?: string
          ghl_updated_at?: string | null
          id?: string
          lost_at?: string | null
          lost_reason_normalized?: string | null
          lost_reason_raw?: string | null
          monetary_value?: number | null
          pipeline_id?: string | null
          property_id?: string
          raw?: Json | null
          stage_id?: string | null
          status?: Database["public"]["Enums"]["ghl_opportunity_status"]
          status_raw?: string | null
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_opportunities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_opportunity_stage_history: {
        Row: {
          changed_at: string
          created_at: string
          from_stage_id: string | null
          id: string
          opportunity_id: string
          property_id: string
          source: Database["public"]["Enums"]["ghl_stage_history_source"]
          to_stage_id: string | null
        }
        Insert: {
          changed_at?: string
          created_at?: string
          from_stage_id?: string | null
          id?: string
          opportunity_id: string
          property_id: string
          source?: Database["public"]["Enums"]["ghl_stage_history_source"]
          to_stage_id?: string | null
        }
        Update: {
          changed_at?: string
          created_at?: string
          from_stage_id?: string | null
          id?: string
          opportunity_id?: string
          property_id?: string
          source?: Database["public"]["Enums"]["ghl_stage_history_source"]
          to_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ghl_opportunity_stage_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "ghl_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_opportunity_stage_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_pipeline_stages: {
        Row: {
          created_at: string
          ghl_pipeline_id: string
          ghl_stage_id: string
          id: string
          name: string | null
          pipeline_id: string
          position: number | null
          property_id: string
          raw: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ghl_pipeline_id: string
          ghl_stage_id: string
          id?: string
          name?: string | null
          pipeline_id: string
          position?: number | null
          property_id: string
          raw?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ghl_pipeline_id?: string
          ghl_stage_id?: string
          id?: string
          name?: string | null
          pipeline_id?: string
          position?: number | null
          property_id?: string
          raw?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "ghl_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_pipeline_stages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_pipelines: {
        Row: {
          created_at: string
          ghl_pipeline_id: string
          id: string
          name: string | null
          property_id: string
          raw: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ghl_pipeline_id: string
          id?: string
          name?: string | null
          property_id: string
          raw?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ghl_pipeline_id?: string
          id?: string
          name?: string | null
          property_id?: string
          raw?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_pipelines_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_tasks: {
        Row: {
          assigned_user_id: string | null
          completed_at: string | null
          contact_id: string | null
          counts_as_attempt: boolean
          created_at: string
          due_at: string | null
          ghl_task_id: string
          id: string
          property_id: string
          raw: Json | null
          status: string | null
          task_type: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          counts_as_attempt?: boolean
          created_at?: string
          due_at?: string | null
          ghl_task_id: string
          id?: string
          property_id: string
          raw?: Json | null
          status?: string | null
          task_type?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          counts_as_attempt?: boolean
          created_at?: string
          due_at?: string | null
          ghl_task_id?: string
          id?: string
          property_id?: string
          raw?: Json | null
          status?: string | null
          task_type?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_users: {
        Row: {
          created_at: string
          email: string | null
          ghl_user_id: string
          id: string
          is_active: boolean
          name: string | null
          property_id: string
          raw: Json | null
          role: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          ghl_user_id: string
          id?: string
          is_active?: boolean
          name?: string | null
          property_id: string
          raw?: Json | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          ghl_user_id?: string
          id?: string
          is_active?: boolean
          name?: string | null
          property_id?: string
          raw?: Json | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_users_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_rankings: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          keyword: string
          keyword_id: number
          position: number | null
          previous_position: number | null
          property_id: string
          ranking_url: string | null
          region: string | null
          search_engine: string | null
          search_volume: number | null
        }
        Insert: {
          captured_at: string
          created_at?: string
          id?: string
          keyword: string
          keyword_id: number
          position?: number | null
          previous_position?: number | null
          property_id: string
          ranking_url?: string | null
          region?: string | null
          search_engine?: string | null
          search_volume?: number | null
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          keyword?: string
          keyword_id?: number
          position?: number | null
          previous_position?: number | null
          property_id?: string
          ranking_url?: string | null
          region?: string | null
          search_engine?: string | null
          search_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "keyword_rankings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_share_of_voice: {
        Row: {
          captured_at: string
          created_at: string
          domain: string
          id: string
          is_own_domain: boolean
          property_id: string
          sov_score: number
        }
        Insert: {
          captured_at: string
          created_at?: string
          domain: string
          id?: string
          is_own_domain?: boolean
          property_id: string
          sov_score: number
        }
        Update: {
          captured_at?: string
          created_at?: string
          domain?: string
          id?: string
          is_own_domain?: boolean
          property_id?: string
          sov_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "keyword_share_of_voice_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          brand_color: string | null
          created_at: string
          hidden_metrics: Json
          id: string
          is_active: boolean
          logo_url: string | null
          metric_labels: Json
          name: string
          primary_color: string | null
          public_report_token: string | null
          slug: string
          timezone: string
        }
        Insert: {
          brand_color?: string | null
          created_at?: string
          hidden_metrics?: Json
          id?: string
          is_active?: boolean
          logo_url?: string | null
          metric_labels?: Json
          name: string
          primary_color?: string | null
          public_report_token?: string | null
          slug: string
          timezone?: string
        }
        Update: {
          brand_color?: string | null
          created_at?: string
          hidden_metrics?: Json
          id?: string
          is_active?: boolean
          logo_url?: string | null
          metric_labels?: Json
          name?: string
          primary_color?: string | null
          public_report_token?: string | null
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
      property_business_hours: {
        Row: {
          closes_at: string | null
          created_at: string
          day_of_week: number
          id: string
          is_closed: boolean
          opens_at: string | null
          property_id: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_closed?: boolean
          opens_at?: string | null
          property_id: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean
          opens_at?: string | null
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_business_hours_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_call_score_mappings: {
        Row: {
          bucket: string
          created_at: string
          id: string
          priority: number
          property_id: string
          score_label: string
          updated_at: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          priority?: number
          property_id: string
          score_label: string
          updated_at?: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          priority?: number
          property_id?: string
          score_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_call_score_mappings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_data_sources: {
        Row: {
          campaign_label_filter: string | null
          config: Json | null
          external_account_id: string | null
          id: string
          is_connected: boolean
          last_error: string | null
          last_synced_at: string | null
          login_customer_id: string | null
          property_id: string
          refresh_token: string | null
          secret_token: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          campaign_label_filter?: string | null
          config?: Json | null
          external_account_id?: string | null
          id?: string
          is_connected?: boolean
          last_error?: string | null
          last_synced_at?: string | null
          login_customer_id?: string | null
          property_id: string
          refresh_token?: string | null
          secret_token?: string | null
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_label_filter?: string | null
          config?: Json | null
          external_account_id?: string | null
          id?: string
          is_connected?: boolean
          last_error?: string | null
          last_synced_at?: string | null
          login_customer_id?: string | null
          property_id?: string
          refresh_token?: string | null
          secret_token?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_data_sources_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_pipeline_mapping: {
        Row: {
          canonical_stage: Database["public"]["Enums"]["ghl_canonical_stage"]
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_by_user: boolean
          created_at: string
          ghl_pipeline_id: string | null
          ghl_stage_id: string
          id: string
          property_id: string
          suggested_canonical_stage:
            | Database["public"]["Enums"]["ghl_canonical_stage"]
            | null
          updated_at: string
        }
        Insert: {
          canonical_stage: Database["public"]["Enums"]["ghl_canonical_stage"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_user?: boolean
          created_at?: string
          ghl_pipeline_id?: string | null
          ghl_stage_id: string
          id?: string
          property_id: string
          suggested_canonical_stage?:
            | Database["public"]["Enums"]["ghl_canonical_stage"]
            | null
          updated_at?: string
        }
        Update: {
          canonical_stage?: Database["public"]["Enums"]["ghl_canonical_stage"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_user?: boolean
          created_at?: string
          ghl_pipeline_id?: string | null
          ghl_stage_id?: string
          id?: string
          property_id?: string
          suggested_canonical_stage?:
            | Database["public"]["Enums"]["ghl_canonical_stage"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_pipeline_mapping_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_settings: {
        Row: {
          data_sources: Json
          property_id: string
          updated_at: string
          visible_metrics: Json
        }
        Insert: {
          data_sources?: Json
          property_id: string
          updated_at?: string
          visible_metrics?: Json
        }
        Update: {
          data_sources?: Json
          property_id?: string
          updated_at?: string
          visible_metrics?: Json
        }
        Relationships: [
          {
            foreignKeyName: "property_settings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_sla_settings: {
        Row: {
          active_window_days: number | null
          after_hours_mode: string | null
          attempts_24h: number | null
          attempts_7d: number | null
          business_hours_only: boolean | null
          created_at: string
          critical_stale_after_hours: number | null
          first_response_seconds: number | null
          property_id: string
          stale_after_hours: number | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          active_window_days?: number | null
          after_hours_mode?: string | null
          attempts_24h?: number | null
          attempts_7d?: number | null
          business_hours_only?: boolean | null
          created_at?: string
          critical_stale_after_hours?: number | null
          first_response_seconds?: number | null
          property_id: string
          stale_after_hours?: number | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          active_window_days?: number | null
          after_hours_mode?: string | null
          attempts_24h?: number | null
          attempts_7d?: number | null
          business_hours_only?: boolean | null
          created_at?: string
          critical_stale_after_hours?: number | null
          first_response_seconds?: number | null
          property_id?: string
          stale_after_hours?: number | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_sla_settings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          acknowledged_at: string | null
          error: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          property_id: string | null
          source: string
          started_at: string
          stats: Json | null
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          error?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          property_id?: string | null
          source: string
          started_at?: string
          stats?: Json | null
          status: string
        }
        Update: {
          acknowledged_at?: string | null
          error?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          property_id?: string | null
          source?: string
          started_at?: string
          stats?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_nav_preferences: {
        Row: {
          order_keys: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          order_keys?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          order_keys?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      viewer_property_access: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "viewer_property_access_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_assistant_context: {
        Args: { _from: string; _property_id: string; _to: string }
        Returns: Json
      }
      get_api_health_summary: {
        Args: never
        Returns: {
          is_connected: boolean
          last_error_message: string
          last_failure_at: string
          last_run_at: string
          last_run_status: string
          last_success_at: string
          property_id: string
          property_name: string
          source: string
        }[]
      }
      get_cron_secret_v2: { Args: never; Returns: string }
      get_ctm_calls_by_report_token: {
        Args: { _from: string; _to: string; _token: string }
        Returns: {
          ad_group: string | null
          call_score_bucket: string | null
          call_score_label: string | null
          called_at: string
          caller_number: string | null
          campaign_name: string | null
          channel: string | null
          ctm_call_id: string
          duration_seconds: number | null
          id: string
          property_id: string
          raw_payload: Json | null
          synced_at: string
          tracking_source: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ctm_calls"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_daily_metrics_by_report_token: {
        Args: { _from: string; _to: string; _token: string }
        Returns: {
          ad_source: string
          admissions: number
          bad_leads: number
          campaign: string
          clicks: number
          cost: number
          created_at: string
          date: string
          good_leads: number
          id: string
          impressions: number
          leads: number
          medicaid: number
          no_entry: number
          property_id: string
          record_count: number
          sessions: number
          spam: number
          users: number
        }[]
        SetofOptions: {
          from: "*"
          to: "daily_metrics"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_keyword_rankings_by_report_token: {
        Args: { _from: string; _to: string; _token: string }
        Returns: {
          captured_at: string
          created_at: string
          id: string
          keyword: string
          keyword_id: number
          position: number | null
          previous_position: number | null
          property_id: string
          ranking_url: string | null
          region: string | null
          search_engine: string | null
          search_volume: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "keyword_rankings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_property_by_report_token: {
        Args: { _token: string }
        Returns: {
          brand_color: string | null
          created_at: string
          hidden_metrics: Json
          id: string
          is_active: boolean
          logo_url: string | null
          metric_labels: Json
          name: string
          primary_color: string | null
          public_report_token: string | null
          slug: string
          timezone: string
        }[]
        SetofOptions: {
          from: "*"
          to: "properties"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_score_mappings_by_report_token: {
        Args: { _token: string }
        Returns: {
          bucket: string
          created_at: string
          id: string
          priority: number
          property_id: string
          score_label: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "property_call_score_mappings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_sync_cron_schedule: {
        Args: never
        Returns: {
          active: boolean
          jobid: number
          schedule: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      lead_perf_agents: {
        Args: { _from: string; _property_ids: string[]; _to: string }
        Returns: {
          agent_name: string
          assigned: number
          avg_human_attempts: number
          booked: number
          booking_rate: number
          contact_rate: number
          contacted: number
          critical_stale_count: number
          ghl_user_id: string
          low_sample: boolean
          median_human_business_seconds: number
          median_human_raw_seconds: number
          property_count: number
          show_rate: number
          showed: number
          stale_count: number
          win_rate: number
          won: number
        }[]
      }
      lead_perf_can_read: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
      lead_perf_check_access: {
        Args: { _property_ids: string[] }
        Returns: undefined
      }
      lead_perf_drill: {
        Args: {
          _from: string
          _issue_type: string
          _limit?: number
          _property_ids: string[]
          _to: string
        }
        Returns: {
          agent_name: string
          assigned_user_id: string
          canonical_stage: Database["public"]["Enums"]["ghl_canonical_stage"]
          contact_id: string
          contact_name: string
          email: string
          first_human_response_at: string
          ghl_deep_link: string
          human_attempt_count: number
          issue_type: string
          last_activity_at: string
          lead_created_at: string
          phone: string
          property_id: string
          property_name: string
          speed_to_lead_seconds: number
          stage_id: string
          stage_name: string
        }[]
      }
      lead_perf_handling: {
        Args: { _from: string; _property_ids: string[]; _to: string }
        Returns: Json
      }
      lead_perf_pipeline: {
        Args: { _from: string; _property_ids: string[]; _to: string }
        Returns: Json
      }
      lead_perf_quality: {
        Args: { _from: string; _property_ids: string[]; _to: string }
        Returns: Json
      }
      lead_perf_speed: {
        Args: { _from: string; _property_ids: string[]; _to: string }
        Returns: Json
      }
      public_ai_assistant_context: {
        Args: { _from: string; _to: string; _token: string }
        Returns: Json
      }
      public_report_client: {
        Args: { _token: string }
        Returns: {
          brand_color: string
          hidden_metrics: Json
          id: string
          logo_url: string
          metric_labels: Json
          name: string
          slug: string
        }[]
      }
      public_report_metrics: {
        Args: { _from: string; _to: string; _token: string }
        Returns: {
          ad_source: string
          admissions: number
          bad_leads: number
          campaign: string
          clicks: number
          cost: number
          created_at: string
          date: string
          good_leads: number
          id: string
          impressions: number
          leads: number
          medicaid: number
          no_entry: number
          property_id: string
          record_count: number
          sessions: number
          spam: number
          users: number
        }[]
        SetofOptions: {
          from: "*"
          to: "daily_metrics"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      public_report_score_mappings: {
        Args: { _token: string }
        Returns: {
          bucket: string
          created_at: string
          id: string
          priority: number
          property_id: string
          score_label: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "property_call_score_mappings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rebuild_lead_facts: { Args: { _property_id: string }; Returns: Json }
      seed_pipeline_mapping_suggestions: {
        Args: { _property_id: string }
        Returns: number
      }
      set_sync_cron_schedule: {
        Args: { _active: boolean; _schedule: string }
        Returns: undefined
      }
      viewer_can_access: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "internal" | "viewer"
      ghl_appointment_status:
        | "booked"
        | "confirmed"
        | "showed"
        | "no_show"
        | "cancelled"
        | "rescheduled"
        | "unknown"
      ghl_canonical_stage:
        | "new"
        | "contacted"
        | "engaged"
        | "appointment"
        | "showed"
        | "won"
        | "lost"
        | "ignore"
      ghl_opportunity_status: "open" | "won" | "lost" | "abandoned" | "unknown"
      ghl_response_source:
        | "human"
        | "automation"
        | "ai"
        | "system"
        | "unknown"
        | "customer"
      ghl_stage_history_source: "sync_diff" | "webhook" | "manual_backfill"
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
      app_role: ["internal", "viewer"],
      ghl_appointment_status: [
        "booked",
        "confirmed",
        "showed",
        "no_show",
        "cancelled",
        "rescheduled",
        "unknown",
      ],
      ghl_canonical_stage: [
        "new",
        "contacted",
        "engaged",
        "appointment",
        "showed",
        "won",
        "lost",
        "ignore",
      ],
      ghl_opportunity_status: ["open", "won", "lost", "abandoned", "unknown"],
      ghl_response_source: [
        "human",
        "automation",
        "ai",
        "system",
        "unknown",
        "customer",
      ],
      ghl_stage_history_source: ["sync_diff", "webhook", "manual_backfill"],
    },
  },
} as const
