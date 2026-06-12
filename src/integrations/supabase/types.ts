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
    },
  },
} as const
