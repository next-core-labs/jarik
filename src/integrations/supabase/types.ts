export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      agreement_change_requests: {
        Row: {
          agreement_id: string;
          created_at: string;
          decided_at: string | null;
          id: string;
          kind: string;
          payload: Json;
          requested_by: string | null;
          status: string;
        };
        Insert: {
          agreement_id: string;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          kind: string;
          payload?: Json;
          requested_by?: string | null;
          status?: string;
        };
        Update: {
          agreement_id?: string;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          kind?: string;
          payload?: Json;
          requested_by?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agreement_change_requests_agreement_id_fkey";
            columns: ["agreement_id"];
            isOneToOne: false;
            referencedRelation: "management_agreements";
            referencedColumns: ["id"];
          },
        ];
      };
      agreement_permissions: {
        Row: {
          agreement_id: string;
          permission: string;
        };
        Insert: {
          agreement_id: string;
          permission: string;
        };
        Update: {
          agreement_id?: string;
          permission?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agreement_permissions_agreement_id_fkey";
            columns: ["agreement_id"];
            isOneToOne: false;
            referencedRelation: "management_agreements";
            referencedColumns: ["id"];
          },
        ];
      };
      agreement_units: {
        Row: {
          agreement_id: string;
          unit_id: string;
        };
        Insert: {
          agreement_id: string;
          unit_id: string;
        };
        Update: {
          agreement_id?: string;
          unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agreement_units_agreement_id_fkey";
            columns: ["agreement_id"];
            isOneToOne: false;
            referencedRelation: "management_agreements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agreement_units_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agreement_units_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: number;
          org_id: string | null;
          row_id: string | null;
          summary: Json | null;
          table_name: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          org_id?: string | null;
          row_id?: string | null;
          summary?: Json | null;
          table_name: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          org_id?: string | null;
          row_id?: string | null;
          summary?: Json | null;
          table_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      building_announcements: {
        Row: {
          body: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          property_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          property_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          property_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "building_announcements_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      cron_job_runs: {
        Row: {
          id: number;
          job_name: string;
          ran_at: string;
          rows_affected: number | null;
        };
        Insert: {
          id?: number;
          job_name: string;
          ran_at?: string;
          rows_affected?: number | null;
        };
        Update: {
          id?: number;
          job_name?: string;
          ran_at?: string;
          rows_affected?: number | null;
        };
        Relationships: [];
      };
      deals: {
        Row: {
          assigned_to: string | null;
          city: string | null;
          client_name: string;
          commission: number;
          commission_rate: number;
          created_at: string;
          district: string | null;
          id: string;
          notes: string | null;
          org_id: string | null;
          phone: string | null;
          property_id: string | null;
          request_type: string;
          stage: string;
          updated_at: string;
          value: number;
        };
        Insert: {
          assigned_to?: string | null;
          city?: string | null;
          client_name: string;
          commission?: number;
          commission_rate?: number;
          created_at?: string;
          district?: string | null;
          id?: string;
          notes?: string | null;
          org_id?: string | null;
          phone?: string | null;
          property_id?: string | null;
          request_type?: string;
          stage?: string;
          updated_at?: string;
          value?: number;
        };
        Update: {
          assigned_to?: string | null;
          city?: string | null;
          client_name?: string;
          commission?: number;
          commission_rate?: number;
          created_at?: string;
          district?: string | null;
          id?: string;
          notes?: string | null;
          org_id?: string | null;
          phone?: string | null;
          property_id?: string | null;
          request_type?: string;
          stage?: string;
          updated_at?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "deals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
          {
            foreignKeyName: "deals_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      demo_requests: {
        Row: {
          city: string | null;
          created_at: string;
          full_name: string;
          id: string;
          notes: string | null;
          office_name: string | null;
          phone: string;
          status: string;
          units_count: number | null;
        };
        Insert: {
          city?: string | null;
          created_at?: string;
          full_name: string;
          id?: string;
          notes?: string | null;
          office_name?: string | null;
          phone: string;
          status?: string;
          units_count?: number | null;
        };
        Update: {
          city?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          notes?: string | null;
          office_name?: string | null;
          phone?: string;
          status?: string;
          units_count?: number | null;
        };
        Relationships: [];
      };
      direct_conversations: {
        Row: {
          created_at: string;
          id: string;
          user_a: string;
          user_b: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          user_a: string;
          user_b: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          user_a?: string;
          user_b?: string;
        };
        Relationships: [];
      };
      direct_messages: {
        Row: {
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          read_at: string | null;
          sender_id: string;
          sender_name: string | null;
        };
        Insert: {
          body: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id: string;
          sender_name?: string | null;
        };
        Update: {
          body?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id?: string;
          sender_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "direct_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "direct_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          amount: number;
          category: string;
          created_at: string;
          expense_date: string;
          id: string;
          notes: string | null;
          org_id: string | null;
          property_id: string | null;
          title: string;
          unit_id: string | null;
          updated_at: string;
        };
        Insert: {
          amount?: number;
          category?: string;
          created_at?: string;
          expense_date?: string;
          id?: string;
          notes?: string | null;
          org_id?: string | null;
          property_id?: string | null;
          title: string;
          unit_id?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category?: string;
          created_at?: string;
          expense_date?: string;
          id?: string;
          notes?: string | null;
          org_id?: string | null;
          property_id?: string | null;
          title?: string;
          unit_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
          {
            foreignKeyName: "expenses_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      hq_admins: {
        Row: {
          created_at: string;
          invited_by: string | null;
          permissions: string[];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          invited_by?: string | null;
          permissions?: string[];
          user_id: string;
        };
        Update: {
          created_at?: string;
          invited_by?: string | null;
          permissions?: string[];
          user_id?: string;
        };
        Relationships: [];
      };
      hq_invitations: {
        Row: {
          answered_at: string | null;
          created_at: string;
          email: string;
          id: string;
          invited_by: string;
          permissions: string[];
          status: string;
        };
        Insert: {
          answered_at?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          invited_by: string;
          permissions?: string[];
          status?: string;
        };
        Update: {
          answered_at?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          invited_by?: string;
          permissions?: string[];
          status?: string;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          is_manager: boolean;
          kind: string;
          org_id: string;
          role: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          is_manager?: boolean;
          kind?: string;
          org_id: string;
          role?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          is_manager?: boolean;
          kind?: string;
          org_id?: string;
          role?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      invoice_counters: {
        Row: {
          last_number: number;
          year: number;
        };
        Insert: {
          last_number?: number;
          year: number;
        };
        Update: {
          last_number?: number;
          year?: number;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          created_at: string;
          customer_name: string;
          customer_vat_number: string | null;
          description: string | null;
          id: string;
          invoice_number: string;
          issue_date: string;
          lease_id: string | null;
          org_id: string | null;
          payment_id: string | null;
          qr_payload: string | null;
          seller_name: string | null;
          seller_vat_number: string | null;
          subtotal: number;
          total: number;
          updated_at: string;
          vat_amount: number;
          zatca_status: string;
          zatca_uuid: string | null;
        };
        Insert: {
          created_at?: string;
          customer_name: string;
          customer_vat_number?: string | null;
          description?: string | null;
          id?: string;
          invoice_number: string;
          issue_date?: string;
          lease_id?: string | null;
          org_id?: string | null;
          payment_id?: string | null;
          qr_payload?: string | null;
          seller_name?: string | null;
          seller_vat_number?: string | null;
          subtotal?: number;
          total?: number;
          updated_at?: string;
          vat_amount?: number;
          zatca_status?: string;
          zatca_uuid?: string | null;
        };
        Update: {
          created_at?: string;
          customer_name?: string;
          customer_vat_number?: string | null;
          description?: string | null;
          id?: string;
          invoice_number?: string;
          issue_date?: string;
          lease_id?: string | null;
          org_id?: string | null;
          payment_id?: string | null;
          qr_payload?: string | null;
          seller_name?: string | null;
          seller_vat_number?: string | null;
          subtotal?: number;
          total?: number;
          updated_at?: string;
          vat_amount?: number;
          zatca_status?: string;
          zatca_uuid?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_lease_id_fkey";
            columns: ["lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
          {
            foreignKeyName: "invoices_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      leases: {
        Row: {
          annual_rent: number;
          created_at: string;
          deposit: number;
          deposit_note: string | null;
          deposit_status: string;
          ejar_contract_no: string | null;
          ejar_status: string;
          end_date: string;
          id: string;
          installments: number;
          start_date: string;
          status: string;
          tenant_id: string;
          term_months: number;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          annual_rent?: number;
          created_at?: string;
          deposit?: number;
          deposit_note?: string | null;
          deposit_status?: string;
          ejar_contract_no?: string | null;
          ejar_status?: string;
          end_date: string;
          id?: string;
          installments?: number;
          start_date: string;
          status?: string;
          tenant_id: string;
          term_months?: number;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          annual_rent?: number;
          created_at?: string;
          deposit?: number;
          deposit_note?: string | null;
          deposit_status?: string;
          ejar_contract_no?: string | null;
          ejar_status?: string;
          end_date?: string;
          id?: string;
          installments?: number;
          start_date?: string;
          status?: string;
          tenant_id?: string;
          term_months?: number;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leases_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leases_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leases_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      legal_pages: {
        Row: {
          body: string;
          slug: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          slug: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          slug?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      link_requests: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          org_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          org_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          org_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "link_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "link_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "link_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "link_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      listing_events: {
        Row: {
          created_at: string;
          event_type: string;
          id: number;
          org_id: string | null;
          unit_id: string;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: never;
          org_id?: string | null;
          unit_id: string;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: never;
          org_id?: string | null;
          unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
          {
            foreignKeyName: "listing_events_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_events_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_favorites: {
        Row: {
          created_at: string;
          unit_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          unit_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          unit_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_favorites_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_favorites_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      login_attempts: {
        Row: {
          email: string;
          failed_count: number;
          last_attempt_at: string;
          locked_until: string | null;
        };
        Insert: {
          email: string;
          failed_count?: number;
          last_attempt_at?: string;
          locked_until?: string | null;
        };
        Update: {
          email?: string;
          failed_count?: number;
          last_attempt_at?: string;
          locked_until?: string | null;
        };
        Relationships: [];
      };
      maintenance_requests: {
        Row: {
          approval_note: string | null;
          approval_status: string;
          audio_path: string | null;
          cost: number;
          created_at: string;
          description: string | null;
          id: string;
          org_id: string | null;
          photo_path: string | null;
          priority: string;
          rated_at: string | null;
          rating: number | null;
          rating_note: string | null;
          scheduled_at: string | null;
          source: string;
          status: string;
          technician_id: string | null;
          tenant_id: string | null;
          title: string;
          unit_id: string | null;
          updated_at: string;
        };
        Insert: {
          approval_note?: string | null;
          approval_status?: string;
          audio_path?: string | null;
          cost?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          org_id?: string | null;
          photo_path?: string | null;
          priority?: string;
          rated_at?: string | null;
          rating?: number | null;
          rating_note?: string | null;
          scheduled_at?: string | null;
          source?: string;
          status?: string;
          technician_id?: string | null;
          tenant_id?: string | null;
          title: string;
          unit_id?: string | null;
          updated_at?: string;
        };
        Update: {
          approval_note?: string | null;
          approval_status?: string;
          audio_path?: string | null;
          cost?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          org_id?: string | null;
          photo_path?: string | null;
          priority?: string;
          rated_at?: string | null;
          rating?: number | null;
          rating_note?: string | null;
          scheduled_at?: string | null;
          source?: string;
          status?: string;
          technician_id?: string | null;
          tenant_id?: string | null;
          title?: string;
          unit_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
          {
            foreignKeyName: "maintenance_requests_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_requests_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_requests_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      management_agreements: {
        Row: {
          accepted_snapshot: Json | null;
          commission_type: string;
          commission_value: number;
          created_at: string;
          end_date: string | null;
          id: string;
          initiated_by: string;
          maintenance_cap: number | null;
          notice_period_days: number;
          office_note: string | null;
          org_id: string;
          owner_id: string;
          owner_note: string | null;
          start_date: string;
          status: string;
          termination_requested_at: string | null;
          termination_requested_by: string | null;
          updated_at: string;
        };
        Insert: {
          accepted_snapshot?: Json | null;
          commission_type?: string;
          commission_value: number;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          initiated_by?: string;
          maintenance_cap?: number | null;
          notice_period_days?: number;
          office_note?: string | null;
          org_id: string;
          owner_id: string;
          owner_note?: string | null;
          start_date: string;
          status?: string;
          termination_requested_at?: string | null;
          termination_requested_by?: string | null;
          updated_at?: string;
        };
        Update: {
          accepted_snapshot?: Json | null;
          commission_type?: string;
          commission_value?: number;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          initiated_by?: string;
          maintenance_cap?: number | null;
          notice_period_days?: number;
          office_note?: string | null;
          org_id?: string;
          owner_id?: string;
          owner_note?: string | null;
          start_date?: string;
          status?: string;
          termination_requested_at?: string | null;
          termination_requested_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "management_agreements_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "management_agreements_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "management_agreements_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "management_agreements_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      market_requests: {
        Row: {
          budget_max: number | null;
          budget_min: number | null;
          city: string | null;
          created_at: string;
          created_by: string | null;
          district: string | null;
          full_name: string;
          id: string;
          notes: string | null;
          phone: string;
          purpose: string;
          status: string;
          unit_type: string | null;
          updated_at: string;
        };
        Insert: {
          budget_max?: number | null;
          budget_min?: number | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          district?: string | null;
          full_name: string;
          id?: string;
          notes?: string | null;
          phone: string;
          purpose?: string;
          status?: string;
          unit_type?: string | null;
          updated_at?: string;
        };
        Update: {
          budget_max?: number | null;
          budget_min?: number | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          district?: string | null;
          full_name?: string;
          id?: string;
          notes?: string | null;
          phone?: string;
          purpose?: string;
          status?: string;
          unit_type?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      meter_readings: {
        Row: {
          created_at: string;
          id: string;
          meter_type: string;
          photo_path: string | null;
          reading: number;
          reading_date: string;
          unit_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          meter_type?: string;
          photo_path?: string | null;
          reading: number;
          reading_date?: string;
          unit_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          meter_type?: string;
          photo_path?: string | null;
          reading?: number;
          reading_date?: string;
          unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meter_readings_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meter_readings_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          kind: string;
          org_id: string | null;
          read_at: string | null;
          related_id: string | null;
          related_table: string | null;
          source: string;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          org_id?: string | null;
          read_at?: string | null;
          related_id?: string | null;
          related_table?: string | null;
          source?: string;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          org_id?: string | null;
          read_at?: string | null;
          related_id?: string | null;
          related_table?: string | null;
          source?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      office_reviews: {
        Row: {
          comment: string | null;
          created_at: string;
          id: string;
          office_id: string;
          rating: number;
          reviewer_id: string;
          reviewer_name: string | null;
          updated_at: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          office_id: string;
          rating: number;
          reviewer_id?: string;
          reviewer_name?: string | null;
          updated_at?: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          office_id?: string;
          rating?: number;
          reviewer_id?: string;
          reviewer_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "office_reviews_office_id_fkey";
            columns: ["office_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "office_reviews_office_id_fkey";
            columns: ["office_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "office_reviews_office_id_fkey";
            columns: ["office_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "office_reviews_office_id_fkey";
            columns: ["office_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      org_clients: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          org_id: string;
          user_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          org_id: string;
          user_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          org_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_clients_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_clients_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_clients_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_clients_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      org_invitations: {
        Row: {
          answered_at: string | null;
          answered_by: string | null;
          created_at: string;
          created_by: string | null;
          email: string;
          id: string;
          is_manager: boolean;
          kind: string;
          org_id: string;
          role: string;
          status: string;
        };
        Insert: {
          answered_at?: string | null;
          answered_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          email: string;
          id?: string;
          is_manager?: boolean;
          kind: string;
          org_id: string;
          role: string;
          status?: string;
        };
        Update: {
          answered_at?: string | null;
          answered_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string;
          id?: string;
          is_manager?: boolean;
          kind?: string;
          org_id?: string;
          role?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      org_members: {
        Row: {
          created_at: string;
          is_manager: boolean;
          kind: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          is_manager?: boolean;
          kind?: string;
          org_id: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          is_manager?: boolean;
          kind?: string;
          org_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      org_settings: {
        Row: {
          address: string | null;
          banner_path: string | null;
          bio: string | null;
          city: string | null;
          company_name: string;
          cr_number: string | null;
          created_at: string;
          created_by: string | null;
          default_commission_pct: number | null;
          district: string | null;
          ejar_broker_id: string | null;
          ejar_enabled: boolean;
          ejar_last_sync: string | null;
          electricity_rate: number;
          fal_license_no: string | null;
          id: string;
          listed_publicly: boolean;
          logo_url: string | null;
          office_code: string | null;
          office_phone: string | null;
          owner_approval_threshold: number;
          updated_at: string;
          vat_number: string | null;
          vat_rate: number;
          verified: boolean;
          water_rate: number;
          whatsapp_locked: boolean;
          whatsapp_number: string | null;
        };
        Insert: {
          address?: string | null;
          banner_path?: string | null;
          bio?: string | null;
          city?: string | null;
          company_name?: string;
          cr_number?: string | null;
          created_at?: string;
          created_by?: string | null;
          default_commission_pct?: number | null;
          district?: string | null;
          ejar_broker_id?: string | null;
          ejar_enabled?: boolean;
          ejar_last_sync?: string | null;
          electricity_rate?: number;
          fal_license_no?: string | null;
          id?: string;
          listed_publicly?: boolean;
          logo_url?: string | null;
          office_code?: string | null;
          office_phone?: string | null;
          owner_approval_threshold?: number;
          updated_at?: string;
          vat_number?: string | null;
          vat_rate?: number;
          verified?: boolean;
          water_rate?: number;
          whatsapp_locked?: boolean;
          whatsapp_number?: string | null;
        };
        Update: {
          address?: string | null;
          banner_path?: string | null;
          bio?: string | null;
          city?: string | null;
          company_name?: string;
          cr_number?: string | null;
          created_at?: string;
          created_by?: string | null;
          default_commission_pct?: number | null;
          district?: string | null;
          ejar_broker_id?: string | null;
          ejar_enabled?: boolean;
          ejar_last_sync?: string | null;
          electricity_rate?: number;
          fal_license_no?: string | null;
          id?: string;
          listed_publicly?: boolean;
          logo_url?: string | null;
          office_code?: string | null;
          office_phone?: string | null;
          owner_approval_threshold?: number;
          updated_at?: string;
          vat_number?: string | null;
          vat_rate?: number;
          verified?: boolean;
          water_rate?: number;
          whatsapp_locked?: boolean;
          whatsapp_number?: string | null;
        };
        Relationships: [];
      };
      owner_pages: {
        Row: {
          areas: string | null;
          avatar_path: string | null;
          bio: string | null;
          created_at: string;
          display_name: string;
          org_id: string | null;
          owner_id: string;
          phone: string | null;
          property_types: string | null;
          published: boolean;
          updated_at: string;
          whatsapp: string | null;
        };
        Insert: {
          areas?: string | null;
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name: string;
          org_id?: string | null;
          owner_id: string;
          phone?: string | null;
          property_types?: string | null;
          published?: boolean;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Update: {
          areas?: string | null;
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string;
          org_id?: string | null;
          owner_id?: string;
          phone?: string | null;
          property_types?: string | null;
          published?: boolean;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "owner_pages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "owner_pages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "owner_pages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "owner_pages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      owner_preferences: {
        Row: {
          auto_approve_limit: number | null;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          auto_approve_limit?: number | null;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          auto_approve_limit?: number | null;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      owner_renewal_decisions: {
        Row: {
          created_at: string;
          decision: string;
          id: string;
          lease_id: string;
          note: string | null;
          owner_id: string;
          proposed_rent: number | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          decision: string;
          id?: string;
          lease_id: string;
          note?: string | null;
          owner_id: string;
          proposed_rent?: number | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          decision?: string;
          id?: string;
          lease_id?: string;
          note?: string | null;
          owner_id?: string;
          proposed_rent?: number | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "owner_renewal_decisions_lease_id_fkey";
            columns: ["lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          collected_by: string | null;
          created_at: string;
          due_date: string;
          id: string;
          last_reminded_at: string | null;
          lease_id: string;
          method: string | null;
          paid_date: string | null;
          reference: string | null;
          status: string;
          transfer_reference: string | null;
          transfer_submitted_at: string | null;
          updated_at: string;
        };
        Insert: {
          amount?: number;
          collected_by?: string | null;
          created_at?: string;
          due_date: string;
          id?: string;
          last_reminded_at?: string | null;
          lease_id: string;
          method?: string | null;
          paid_date?: string | null;
          reference?: string | null;
          status?: string;
          transfer_reference?: string | null;
          transfer_submitted_at?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          collected_by?: string | null;
          created_at?: string;
          due_date?: string;
          id?: string;
          last_reminded_at?: string | null;
          lease_id?: string;
          method?: string | null;
          paid_date?: string | null;
          reference?: string | null;
          status?: string;
          transfer_reference?: string | null;
          transfer_submitted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_lease_id_fkey";
            columns: ["lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_announcements: {
        Row: {
          body: string;
          created_at: string;
          created_by: string | null;
          id: string;
          recipient_count: number;
          title: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          recipient_count?: number;
          title: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          recipient_count?: number;
          title?: string;
        };
        Relationships: [];
      };
      platform_commissions: {
        Row: {
          amount: number;
          collected_at: string | null;
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          org_id: string;
          status: string;
        };
        Insert: {
          amount: number;
          collected_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description: string;
          id?: string;
          org_id: string;
          status?: string;
        };
        Update: {
          amount?: number;
          collected_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          org_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_commissions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_commissions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_commissions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_commissions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      platform_feedback: {
        Row: {
          category: string;
          created_at: string;
          id: string;
          message: string;
          rating: number | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          id?: string;
          message: string;
          rating?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          id?: string;
          message?: string;
          rating?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      platform_settings: {
        Row: {
          announcement_banner: string | null;
          id: boolean;
          new_office_registration_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          announcement_banner?: string | null;
          id?: boolean;
          new_office_registration_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          announcement_banner?: string | null;
          id?: boolean;
          new_office_registration_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          account_type: string | null;
          avatar_path: string | null;
          created_at: string;
          fal_license_no: string | null;
          full_name: string | null;
          id: string;
          id_type: string | null;
          national_id: string | null;
          phone: string | null;
          reference_code: string | null;
          suspended: boolean;
          suspended_at: string | null;
          updated_at: string;
          vip: boolean;
        };
        Insert: {
          account_type?: string | null;
          avatar_path?: string | null;
          created_at?: string;
          fal_license_no?: string | null;
          full_name?: string | null;
          id: string;
          id_type?: string | null;
          national_id?: string | null;
          phone?: string | null;
          reference_code?: string | null;
          suspended?: boolean;
          suspended_at?: string | null;
          updated_at?: string;
          vip?: boolean;
        };
        Update: {
          account_type?: string | null;
          avatar_path?: string | null;
          created_at?: string;
          fal_license_no?: string | null;
          full_name?: string | null;
          id?: string;
          id_type?: string | null;
          national_id?: string | null;
          phone?: string | null;
          reference_code?: string | null;
          suspended?: boolean;
          suspended_at?: string | null;
          updated_at?: string;
          vip?: boolean;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          address: string | null;
          building_type: string | null;
          city: string | null;
          created_at: string;
          deed_number: string | null;
          district: string | null;
          elevators: number | null;
          floors_count: number | null;
          id: string;
          lat: number | null;
          lng: number | null;
          name: string;
          notes: string | null;
          org_id: string | null;
          owner_id: string | null;
          owner_name: string | null;
          parking_spaces: number | null;
          property_type: string;
          structure: string;
          updated_at: string;
          year_built: number | null;
        };
        Insert: {
          address?: string | null;
          building_type?: string | null;
          city?: string | null;
          created_at?: string;
          deed_number?: string | null;
          district?: string | null;
          elevators?: number | null;
          floors_count?: number | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          name: string;
          notes?: string | null;
          org_id?: string | null;
          owner_id?: string | null;
          owner_name?: string | null;
          parking_spaces?: number | null;
          property_type?: string;
          structure?: string;
          updated_at?: string;
          year_built?: number | null;
        };
        Update: {
          address?: string | null;
          building_type?: string | null;
          city?: string | null;
          created_at?: string;
          deed_number?: string | null;
          district?: string | null;
          elevators?: number | null;
          floors_count?: number | null;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          name?: string;
          notes?: string | null;
          org_id?: string | null;
          owner_id?: string | null;
          owner_name?: string | null;
          parking_spaces?: number | null;
          property_type?: string;
          structure?: string;
          updated_at?: string;
          year_built?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "properties_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      property_documents: {
        Row: {
          created_at: string;
          doc_number: string | null;
          expires_at: string | null;
          file_path: string | null;
          id: string;
          kind: string;
          notes: string | null;
          property_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          doc_number?: string | null;
          expires_at?: string | null;
          file_path?: string | null;
          id?: string;
          kind?: string;
          notes?: string | null;
          property_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          doc_number?: string | null;
          expires_at?: string | null;
          file_path?: string | null;
          id?: string;
          kind?: string;
          notes?: string | null;
          property_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_documents_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          action: string;
          count: number;
          user_id: string;
          window_start: string;
        };
        Insert: {
          action: string;
          count?: number;
          user_id: string;
          window_start: string;
        };
        Update: {
          action?: string;
          count?: number;
          user_id?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      referral_codes: {
        Row: {
          code: string;
          created_at: string;
          user_id: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          user_id: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      referrals: {
        Row: {
          created_at: string;
          id: string;
          org_id: string | null;
          referred_name: string;
          referred_phone: string | null;
          referrer_id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id?: string | null;
          referred_name: string;
          referred_phone?: string | null;
          referrer_id: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string | null;
          referred_name?: string;
          referred_phone?: string | null;
          referrer_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "referrals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      renewal_requests: {
        Row: {
          created_at: string;
          decision: string;
          id: string;
          lease_id: string;
          note: string | null;
          status: string;
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          decision: string;
          id?: string;
          lease_id: string;
          note?: string | null;
          status?: string;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          decision?: string;
          id?: string;
          lease_id?: string;
          note?: string | null;
          status?: string;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "renewal_requests_lease_id_fkey";
            columns: ["lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "renewal_requests_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      repair_invoices: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          invoice_date: string;
          invoice_number: string | null;
          notes: string | null;
          title: string;
          unit_id: string;
          updated_at: string;
          vendor: string | null;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          id?: string;
          invoice_date?: string;
          invoice_number?: string | null;
          notes?: string | null;
          title: string;
          unit_id: string;
          updated_at?: string;
          vendor?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          invoice_date?: string;
          invoice_number?: string | null;
          notes?: string | null;
          title?: string;
          unit_id?: string;
          updated_at?: string;
          vendor?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "repair_invoices_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repair_invoices_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      site_visits: {
        Row: {
          created_at: string;
          id: number;
          path: string;
          visitor_id: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          path: string;
          visitor_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          path?: string;
          visitor_id?: string;
        };
        Relationships: [];
      };
      tenant_invites: {
        Row: {
          created_at: string;
          created_by: string | null;
          email: string;
          id: string;
          lease_id: string;
          org_id: string | null;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          email: string;
          id?: string;
          lease_id: string;
          org_id?: string | null;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          email?: string;
          id?: string;
          lease_id?: string;
          org_id?: string | null;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_invites_lease_id_fkey";
            columns: ["lease_id"];
            isOneToOne: false;
            referencedRelation: "leases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_invites_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_invites_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_invites_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_invites_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          national_id: string | null;
          notes: string | null;
          org_id: string | null;
          phone: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name: string;
          id?: string;
          national_id?: string | null;
          notes?: string | null;
          org_id?: string | null;
          phone?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          national_id?: string | null;
          notes?: string | null;
          org_id?: string | null;
          phone?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tenants_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenants_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenants_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenants_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      unit_events: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          kind: string;
          title: string;
          unit_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          title: string;
          unit_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          title?: string;
          unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "unit_events_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_events_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      unit_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          read_at: string | null;
          sender_id: string;
          sender_name: string | null;
          sender_role: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id: string;
          sender_name?: string | null;
          sender_role?: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id?: string;
          sender_name?: string | null;
          sender_role?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "unit_messages_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_messages_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      unit_photos: {
        Row: {
          caption: string | null;
          created_at: string;
          id: string;
          path: string;
          position: number;
          unit_id: string;
          updated_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          caption?: string | null;
          created_at?: string;
          id?: string;
          path: string;
          position?: number;
          unit_id: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          caption?: string | null;
          created_at?: string;
          id?: string;
          path?: string;
          position?: number;
          unit_id?: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "unit_photos_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_photos_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      unit_requests: {
        Row: {
          budget: number | null;
          city: string | null;
          created_at: string;
          created_by: string | null;
          district: string | null;
          full_name: string;
          id: string;
          notes: string | null;
          org_id: string | null;
          phone: string;
          purpose: string;
          status: string;
          unit_id: string | null;
          unit_type: string | null;
          updated_at: string;
        };
        Insert: {
          budget?: number | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          district?: string | null;
          full_name: string;
          id?: string;
          notes?: string | null;
          org_id?: string | null;
          phone: string;
          purpose?: string;
          status?: string;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Update: {
          budget?: number | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          district?: string | null;
          full_name?: string;
          id?: string;
          notes?: string | null;
          org_id?: string | null;
          phone?: string;
          purpose?: string;
          status?: string;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "unit_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
          {
            foreignKeyName: "unit_requests_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_requests_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      units: {
        Row: {
          amenities: string[];
          annual_rent: number;
          area: number | null;
          auto_price_decay: boolean;
          bathrooms: number;
          created_at: string;
          deed_number: string | null;
          district: string | null;
          electricity_meter_no: string | null;
          featured: boolean;
          featured_at: string | null;
          floor_no: string | null;
          furnished: boolean;
          furnishing: string;
          furniture: Json;
          furniture_notes: string | null;
          halls: number;
          id: string;
          list_price: number | null;
          listing_description: string | null;
          listing_purpose: string;
          market_listed: boolean;
          market_listed_at: string | null;
          market_note: string | null;
          notes: string | null;
          owner_id: string | null;
          price_decayed_at: string | null;
          price_floor: number | null;
          property_id: string;
          rooms: number | null;
          sale_price: number;
          status: string;
          street: string | null;
          tenant_id: string | null;
          unit_name: string | null;
          unit_number: string;
          unit_type: string;
          updated_at: string;
          vacant_since: string | null;
          water_meter_no: string | null;
        };
        Insert: {
          amenities?: string[];
          annual_rent?: number;
          area?: number | null;
          auto_price_decay?: boolean;
          bathrooms?: number;
          created_at?: string;
          deed_number?: string | null;
          district?: string | null;
          electricity_meter_no?: string | null;
          featured?: boolean;
          featured_at?: string | null;
          floor_no?: string | null;
          furnished?: boolean;
          furnishing?: string;
          furniture?: Json;
          furniture_notes?: string | null;
          halls?: number;
          id?: string;
          list_price?: number | null;
          listing_description?: string | null;
          listing_purpose?: string;
          market_listed?: boolean;
          market_listed_at?: string | null;
          market_note?: string | null;
          notes?: string | null;
          owner_id?: string | null;
          price_decayed_at?: string | null;
          price_floor?: number | null;
          property_id: string;
          rooms?: number | null;
          sale_price?: number;
          status?: string;
          street?: string | null;
          tenant_id?: string | null;
          unit_name?: string | null;
          unit_number: string;
          unit_type?: string;
          updated_at?: string;
          vacant_since?: string | null;
          water_meter_no?: string | null;
        };
        Update: {
          amenities?: string[];
          annual_rent?: number;
          area?: number | null;
          auto_price_decay?: boolean;
          bathrooms?: number;
          created_at?: string;
          deed_number?: string | null;
          district?: string | null;
          electricity_meter_no?: string | null;
          featured?: boolean;
          featured_at?: string | null;
          floor_no?: string | null;
          furnished?: boolean;
          furnishing?: string;
          furniture?: Json;
          furniture_notes?: string | null;
          halls?: number;
          id?: string;
          list_price?: number | null;
          listing_description?: string | null;
          listing_purpose?: string;
          market_listed?: boolean;
          market_listed_at?: string | null;
          market_note?: string | null;
          notes?: string | null;
          owner_id?: string | null;
          price_decayed_at?: string | null;
          price_floor?: number | null;
          property_id?: string;
          rooms?: number | null;
          sale_price?: number;
          status?: string;
          street?: string | null;
          tenant_id?: string | null;
          unit_name?: string | null;
          unit_number?: string;
          unit_type?: string;
          updated_at?: string;
          vacant_since?: string | null;
          water_meter_no?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "units_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "units_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      whatsapp_channels: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          office_name: string;
          org_id: string | null;
          owner_id: string;
          phone: string;
          provider: string;
          updated_at: string;
          verify_token: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          office_name: string;
          org_id?: string | null;
          owner_id: string;
          phone: string;
          provider?: string;
          updated_at?: string;
          verify_token?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          office_name?: string;
          org_id?: string | null;
          owner_id?: string;
          phone?: string;
          provider?: string;
          updated_at?: string;
          verify_token?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_channels_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_channels_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_channels_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_channels_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
      whatsapp_messages: {
        Row: {
          action_taken: string | null;
          body: string;
          channel_id: string | null;
          created_at: string;
          direction: string;
          id: string;
          intent: string | null;
          notification_id: string | null;
          org_id: string | null;
          phone: string;
          provider_message_id: string | null;
          sender_role: string | null;
          suggested_reply: string | null;
        };
        Insert: {
          action_taken?: string | null;
          body: string;
          channel_id?: string | null;
          created_at?: string;
          direction?: string;
          id?: string;
          intent?: string | null;
          notification_id?: string | null;
          org_id?: string | null;
          phone: string;
          provider_message_id?: string | null;
          sender_role?: string | null;
          suggested_reply?: string | null;
        };
        Update: {
          action_taken?: string | null;
          body?: string;
          channel_id?: string | null;
          created_at?: string;
          direction?: string;
          id?: string;
          intent?: string | null;
          notification_id?: string | null;
          org_id?: string | null;
          phone?: string;
          provider_message_id?: string | null;
          sender_role?: string | null;
          suggested_reply?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "notifications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "office_pages_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "org_settings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["office_id"];
          },
        ];
      };
    };
    Views: {
      market_requests_public: {
        Row: {
          budget_max: number | null;
          budget_min: number | null;
          city: string | null;
          created_at: string | null;
          district: string | null;
          id: string | null;
          notes: string | null;
          purpose: string | null;
          unit_type: string | null;
        };
        Insert: {
          budget_max?: number | null;
          budget_min?: number | null;
          city?: string | null;
          created_at?: string | null;
          district?: string | null;
          id?: string | null;
          notes?: string | null;
          purpose?: string | null;
          unit_type?: string | null;
        };
        Update: {
          budget_max?: number | null;
          budget_min?: number | null;
          city?: string | null;
          created_at?: string | null;
          district?: string | null;
          id?: string | null;
          notes?: string | null;
          purpose?: string | null;
          unit_type?: string | null;
        };
        Relationships: [];
      };
      office_directory: {
        Row: {
          city: string | null;
          company_name: string | null;
          district: string | null;
          fal_license_no: string | null;
          id: string | null;
          logo_url: string | null;
          office_code: string | null;
          office_phone: string | null;
        };
        Insert: {
          city?: string | null;
          company_name?: string | null;
          district?: string | null;
          fal_license_no?: string | null;
          id?: string | null;
          logo_url?: string | null;
          office_code?: string | null;
          office_phone?: string | null;
        };
        Update: {
          city?: string | null;
          company_name?: string | null;
          district?: string | null;
          fal_license_no?: string | null;
          id?: string | null;
          logo_url?: string | null;
          office_code?: string | null;
          office_phone?: string | null;
        };
        Relationships: [];
      };
      office_pages_public: {
        Row: {
          avg_rating: number | null;
          banner_path: string | null;
          bio: string | null;
          city: string | null;
          company_name: string | null;
          district: string | null;
          fal_license_no: string | null;
          id: string | null;
          listings_count: number | null;
          logo_url: string | null;
          office_phone: string | null;
          ratings_count: number | null;
          whatsapp_number: string | null;
        };
        Insert: {
          avg_rating?: never;
          banner_path?: string | null;
          bio?: string | null;
          city?: string | null;
          company_name?: string | null;
          district?: string | null;
          fal_license_no?: string | null;
          id?: string | null;
          listings_count?: never;
          logo_url?: string | null;
          office_phone?: string | null;
          ratings_count?: never;
          whatsapp_number?: string | null;
        };
        Update: {
          avg_rating?: never;
          banner_path?: string | null;
          bio?: string | null;
          city?: string | null;
          company_name?: string | null;
          district?: string | null;
          fal_license_no?: string | null;
          id?: string | null;
          listings_count?: never;
          logo_url?: string | null;
          office_phone?: string | null;
          ratings_count?: never;
          whatsapp_number?: string | null;
        };
        Relationships: [];
      };
      owner_pages_public: {
        Row: {
          areas: string | null;
          avatar_path: string | null;
          bio: string | null;
          display_name: string | null;
          listings_count: number | null;
          owner_id: string | null;
          phone: string | null;
          property_types: string | null;
          whatsapp: string | null;
        };
        Relationships: [];
      };
      vacant_unit_photos_public: {
        Row: {
          path: string | null;
          position: number | null;
          unit_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "unit_photos_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_photos_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "vacant_units_public";
            referencedColumns: ["id"];
          },
        ];
      };
      vacant_units_public: {
        Row: {
          amenities: string[] | null;
          annual_rent: number | null;
          area: number | null;
          bathrooms: number | null;
          company_name: string | null;
          contact_phone: string | null;
          contact_whatsapp: string | null;
          cover_path: string | null;
          created_at: string | null;
          district: string | null;
          fal_license_no: string | null;
          featured: boolean | null;
          floor_no: string | null;
          furnished: boolean | null;
          furnishing: string | null;
          furniture: Json | null;
          halls: number | null;
          id: string | null;
          lat: number | null;
          list_price: number | null;
          listing_description: string | null;
          listing_purpose: string | null;
          lng: number | null;
          logo_url: string | null;
          office_city: string | null;
          office_district: string | null;
          office_id: string | null;
          office_phone: string | null;
          owner_avatar_path: string | null;
          owner_name: string | null;
          owner_page_id: string | null;
          photos_count: number | null;
          rooms: number | null;
          sale_price: number | null;
          street: string | null;
          unit_name: string | null;
          unit_number: string | null;
          unit_type: string | null;
          whatsapp_number: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_hq_invitation: { Args: { _id: string }; Returns: undefined };
      accept_invitation: { Args: { _id: string }; Returns: undefined };
      admin_list_offices: {
        Args: never;
        Returns: {
          city: string;
          company_name: string;
          created_at: string;
          district: string;
          fal_license_no: string;
          id: string;
          listed_publicly: boolean;
          manager_email: string;
          members: number;
          office_phone: string;
          properties: number;
          units: number;
          verified: boolean;
          whatsapp_locked: boolean;
        }[];
      };
      admin_set_office_flags:
        | {
            Args: { _org: string; _whatsapp_locked: boolean };
            Returns: undefined;
          }
        | {
            Args: {
              _listed_publicly?: boolean;
              _org: string;
              _whatsapp_locked?: boolean;
            };
            Returns: undefined;
          };
      admin_set_office_verified: {
        Args: { _org: string; _verified: boolean };
        Returns: undefined;
      };
      cancel_link_request: { Args: { _id: string }; Returns: undefined };
      check_rate_limit: {
        Args: { _action: string; _max: number; _window_seconds: number };
        Returns: boolean;
      };
      decay_vacant_unit_prices: { Args: never; Returns: number };
      decline_hq_invitation: { Args: { _id: string }; Returns: undefined };
      decline_invitation: { Args: { _id: string }; Returns: undefined };
      effective_maintenance_cap: {
        Args: { _org_id: string; _unit_id: string };
        Returns: number;
      };
      effective_maintenance_caps: {
        Args: { _org_id: string; _unit_ids: string[] };
        Returns: {
          cap: number;
          unit_id: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      hq_admin_invitations: {
        Args: never;
        Returns: {
          created_at: string;
          email: string;
          id: string;
          permissions: string[];
        }[];
      };
      hq_list_offices: {
        Args: never;
        Returns: {
          city: string;
          company_name: string;
          created_at: string;
          district: string;
          fal_license_no: string;
          id: string;
          listed_publicly: boolean;
          manager_email: string;
          members: number;
          office_phone: string;
          properties: number;
          units: number;
          verified: boolean;
          whatsapp_locked: boolean;
        }[];
      };
      hq_set_office_flags: {
        Args: { _org: string; _whatsapp_locked: boolean };
        Returns: undefined;
      };
      hq_set_office_verified: {
        Args: { _org: string; _verified: boolean };
        Returns: undefined;
      };
      hq_set_unit_featured: {
        Args: { _featured: boolean; _unit: string };
        Returns: undefined;
      };
      hq_update_platform_settings: {
        Args: {
          _announcement_banner: string;
          _new_office_registration_enabled: boolean;
        };
        Returns: undefined;
      };
      invite_hq_admin: {
        Args: { _email: string; _permissions: string[] };
        Returns: string;
      };
      is_office_manager: { Args: never; Returns: boolean };
      is_staff: { Args: { _user_id: string }; Returns: boolean };
      list_hq_admins: {
        Args: never;
        Returns: {
          created_at: string;
          email: string;
          full_name: string;
          permissions: string[];
          user_id: string;
        }[];
      };
      market_stats: {
        Args: never;
        Returns: {
          avg_rent: number;
          district: string;
          occupancy_pct: number;
          units_count: number;
        }[];
      };
      my_agreement_offices: {
        Args: never;
        Returns: {
          company_name: string;
          org_id: string;
        }[];
      };
      my_direct_conversations: {
        Args: never;
        Returns: {
          id: string;
          last_message: string;
          last_message_at: string;
          other_full_name: string;
          other_user_id: string;
        }[];
      };
      my_hq_invitations: {
        Args: never;
        Returns: {
          created_at: string;
          id: string;
          permissions: string[];
        }[];
      };
      my_invitations: {
        Args: never;
        Returns: {
          id: string;
          is_manager: boolean;
          kind: string;
          office_name: string;
          org_id: string;
          role: string;
        }[];
      };
      my_link_requests: {
        Args: never;
        Returns: {
          created_at: string;
          id: string;
          kind: string;
          office_name: string;
          org_id: string;
          status: string;
        }[];
      };
      my_org: { Args: never; Returns: string };
      my_org_id: { Args: never; Returns: string };
      my_org_ids: { Args: never; Returns: string[] };
      my_reference_code: { Args: never; Returns: string };
      my_referral_code: { Args: never; Returns: string };
      next_invoice_number: { Args: { _year: number }; Returns: string };
      notify_expiring_leases: { Args: { _days?: number }; Returns: number };
      notify_unit: {
        Args: { _body: string; _kind: string; _title: string; _unit_id: string };
        Returns: undefined;
      };
      notify_unit_staff: {
        Args: { _body: string; _kind: string; _title: string; _unit_id: string };
        Returns: undefined;
      };
      office_add_member: {
        Args: { _email: string; _manager: boolean; _role: string };
        Returns: undefined;
      };
      office_agreement_requests: {
        Args: never;
        Returns: {
          commission_type: string;
          commission_value: number;
          created_at: string;
          end_date: string;
          id: string;
          maintenance_cap: number;
          notice_period_days: number;
          office_note: string;
          owner_email: string;
          owner_name: string;
          owner_note: string;
          permissions: string[];
          start_date: string;
          status: string;
          termination_requested_at: string;
          termination_requested_by: string;
          units: Json;
          units_count: number;
        }[];
      };
      office_decide_change_request: {
        Args: { _decision: string; _request_id: string };
        Returns: undefined;
      };
      office_decide_link_request: {
        Args: { _accept: boolean; _id: string };
        Returns: undefined;
      };
      office_invitations: {
        Args: never;
        Returns: {
          created_at: string;
          email: string;
          id: string;
          is_manager: boolean;
          kind: string;
          role: string;
        }[];
      };
      office_link_client: {
        Args: { _email: string; _kind: string };
        Returns: undefined;
      };
      office_link_requests: {
        Args: never;
        Returns: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          kind: string;
          user_id: string;
        }[];
      };
      office_people: {
        Args: never;
        Returns: {
          email: string;
          full_name: string;
          is_manager: boolean;
          phone: string;
          relation: string;
          roles: string[];
          user_id: string;
        }[];
      };
      office_remove_member: { Args: { _user: string }; Returns: undefined };
      office_respond_agreement: {
        Args: {
          _agreement_id: string;
          _commission_value?: number;
          _decision: string;
          _maintenance_cap?: number;
          _note?: string;
          _notice_period_days?: number;
          _permissions?: string[];
        };
        Returns: undefined;
      };
      office_revoke_invitation: { Args: { _id: string }; Returns: undefined };
      office_set_manager: {
        Args: { _manager: boolean; _user: string };
        Returns: undefined;
      };
      office_unlink_client: { Args: { _user: string }; Returns: undefined };
      offices_near: {
        Args: {
          _city?: string;
          _district?: string;
          _lat?: number;
          _lng?: number;
        };
        Returns: {
          city: string;
          company_name: string;
          distance_km: number;
          district: string;
          fal_license_no: string;
          id: string;
          logo_url: string;
          office_phone: string;
          same_city: boolean;
          same_district: boolean;
        }[];
      };
      org_of: { Args: { _id: string; _table: string }; Returns: string };
      org_user_ids: { Args: { _org: string }; Returns: string[] };
      orgs_of_user: { Args: { _uid: string }; Returns: string[] };
      owner_cashflow_forecast: {
        Args: never;
        Returns: {
          due: number;
          month: string;
          paid: number;
        }[];
      };
      owner_decide_countered_agreement: {
        Args: { _agreement_id: string; _decision: string };
        Returns: undefined;
      };
      owner_expenses_12m: {
        Args: never;
        Returns: {
          amount: number;
          category: string;
          expense_date: string;
          id: string;
          property_name: string;
          title: string;
          unit_number: string;
        }[];
      };
      owner_finance_summary: { Args: never; Returns: Json };
      owner_offices: {
        Args: never;
        Returns: {
          address: string;
          city: string;
          company_name: string;
          district: string;
          fal_license_no: string;
          id: string;
          logo_url: string;
          office_phone: string;
          units_count: number;
        }[];
      };
      owner_pending_approvals: {
        Args: never;
        Returns: {
          cost: number;
          created_at: string;
          description: string;
          id: string;
          priority: string;
          property_name: string;
          title: string;
          unit_number: string;
        }[];
      };
      owner_property_locations: {
        Args: never;
        Returns: {
          lat: number;
          lng: number;
          property_id: string;
        }[];
      };
      owner_property_returns: {
        Args: never;
        Returns: {
          annual_rent: number;
          collected_12m: number;
          expenses_12m: number;
          net_12m: number;
          net_pct: number;
          property_id: string;
          property_name: string;
          units_count: number;
        }[];
      };
      owner_property_roi: {
        Args: never;
        Returns: {
          collected: number;
          expenses: number;
          net: number;
          property_id: string;
          property_name: string;
          roi_pct: number;
          units_count: number;
        }[];
      };
      owner_renewals: {
        Args: never;
        Returns: {
          lease_id: string;
          owner_decided_at: string;
          owner_decision: string;
          owner_note: string;
          owner_proposed_rent: number;
          owner_status: string;
          tenant_decided_at: string;
          tenant_decision: string;
        }[];
      };
      owner_submit_renewal_decision: {
        Args: {
          _decision: string;
          _lease_id: string;
          _note?: string;
          _proposed_rent?: number;
        };
        Returns: string;
      };
      owner_units: {
        Args: never;
        Returns: {
          annual_rent: number;
          city: string;
          district: string;
          lease_annual_rent: number;
          lease_end_date: string;
          lease_id: string;
          property_id: string;
          property_name: string;
          status: string;
          unit_id: string;
          unit_number: string;
          unit_type: string;
        }[];
      };
      owner_vacancies: {
        Args: never;
        Returns: {
          market_listed: boolean;
          peer_avg_rent: number;
          peer_units: number;
          photos_count: number;
          publicly_listed: boolean;
          unit_id: string;
          vacant_since: string;
        }[];
      };
      register_office: {
        Args: {
          _city: string;
          _district: string;
          _fal: string;
          _name: string;
          _phone: string;
        };
        Returns: string;
      };
      remove_hq_admin: { Args: { _user_id: string }; Returns: undefined };
      renew_lease: {
        Args: {
          _annual_rent: number;
          _installments: number;
          _source_lease_id: string;
          _start_date: string;
          _term_months?: number;
        };
        Returns: string;
      };
      request_agreement_termination: {
        Args: { _agreement_id: string };
        Returns: undefined;
      };
      request_management_agreement: {
        Args: {
          _commission_type: string;
          _commission_value: number;
          _end_date: string;
          _maintenance_cap: number;
          _note?: string;
          _notice_period_days: number;
          _org_id: string;
          _permissions: string[];
          _start_date: string;
          _unit_ids: string[];
        };
        Returns: string;
      };
      request_office_link: {
        Args: { _kind: string; _office_code: string };
        Returns: string;
      };
      revoke_hq_invitation: { Args: { _id: string }; Returns: undefined };
      set_legal_page: {
        Args: { _body: string; _slug: string; _title: string };
        Returns: undefined;
      };
      set_subscriber_vip: {
        Args: { _user_id: string; _vip: boolean };
        Returns: undefined;
      };
      site_visit_stats: {
        Args: never;
        Returns: {
          total_visits: number;
          unique_visitors: number;
          unique_visitors_30d: number;
          visits_30d: number;
        }[];
      };
      smart_payment_reminders: { Args: never; Returns: number };
      start_direct_conversation: { Args: { _code: string }; Returns: string };
      submit_feedback: {
        Args: { _category: string; _message: string; _rating: number };
        Returns: undefined;
      };
      technician_job_contacts: {
        Args: never;
        Returns: {
          request_id: string;
          tenant_name: string;
          tenant_phone: string;
        }[];
      };
      tenant_overdue_count: { Args: { _tenant_id: string }; Returns: number };
      update_agreement_permissions: {
        Args: { _agreement_id: string; _permissions: string[] };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "staff" | "owner" | "tenant" | "technician" | "super_admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff", "owner", "tenant", "technician", "super_admin"],
    },
  },
} as const;
