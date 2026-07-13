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
      clipart_categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          print_method_key: string | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          print_method_key?: string | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          print_method_key?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clipart_categories_print_method_key_fkey"
            columns: ["print_method_key"]
            isOneToOne: false
            referencedRelation: "designer_print_methods"
            referencedColumns: ["key"]
          },
        ]
      }
      clipart_items: {
        Row: {
          category_id: string | null
          created_at: string | null
          file_type: string | null
          file_url: string
          id: string
          is_active: boolean | null
          name: string
          print_method_key: string | null
          sort_order: number | null
          tags: string[] | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          file_type?: string | null
          file_url: string
          id?: string
          is_active?: boolean | null
          name: string
          print_method_key?: string | null
          sort_order?: number | null
          tags?: string[] | null
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          file_type?: string | null
          file_url?: string
          id?: string
          is_active?: boolean | null
          name?: string
          print_method_key?: string | null
          sort_order?: number | null
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "clipart_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "clipart_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clipart_items_print_method_key_fkey"
            columns: ["print_method_key"]
            isOneToOne: false
            referencedRelation: "designer_print_methods"
            referencedColumns: ["key"]
          },
        ]
      }
      design_orders: {
        Row: {
          available_sizes: string[] | null
          billing_address: Json | null
          canvas_json_back: string | null
          canvas_json_front: string | null
          canvas_png_back: string | null
          canvas_png_front: string | null
          canvas_svg_back: string | null
          canvas_svg_front: string | null
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          notes: string | null
          price_per_item: number | null
          print_charge: number | null
          print_charge_back: number | null
          print_charge_front: number | null
          print_method: string | null
          product_title: string | null
          quantities: Json | null
          selected_color: string | null
          selected_color_hex: string | null
          shipping_address: Json | null
          shopify_cart_url: string | null
          shopify_order_id: string | null
          shopify_order_number: string | null
          shopify_product_id: string | null
          shopify_variant_id: string | null
          sides_designed: number | null
          status: string | null
          total_price: number | null
          total_qty: number | null
          unit_price: number | null
          uploaded_files: Json | null
          template_id: string | null
          print_area_front_id: string | null
          print_area_back_id: string | null
          print_area_front: Json | null
          print_area_back: Json | null
        }
        Insert: {
          available_sizes?: string[] | null
          billing_address?: Json | null
          canvas_json_back?: string | null
          canvas_json_front?: string | null
          canvas_png_back?: string | null
          canvas_png_front?: string | null
          canvas_svg_back?: string | null
          canvas_svg_front?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          price_per_item?: number | null
          print_charge?: number | null
          print_charge_back?: number | null
          print_charge_front?: number | null
          print_method?: string | null
          product_title?: string | null
          quantities?: Json | null
          selected_color?: string | null
          selected_color_hex?: string | null
          shipping_address?: Json | null
          shopify_cart_url?: string | null
          shopify_order_id?: string | null
          shopify_order_number?: string | null
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          sides_designed?: number | null
          status?: string | null
          total_price?: number | null
          total_qty?: number | null
          unit_price?: number | null
          uploaded_files?: Json | null
          template_id?: string | null
          print_area_front_id?: string | null
          print_area_back_id?: string | null
          print_area_front?: Json | null
          print_area_back?: Json | null
        }
        Update: {
          available_sizes?: string[] | null
          billing_address?: Json | null
          canvas_json_back?: string | null
          canvas_json_front?: string | null
          canvas_png_back?: string | null
          canvas_png_front?: string | null
          canvas_svg_back?: string | null
          canvas_svg_front?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          price_per_item?: number | null
          print_charge?: number | null
          print_charge_back?: number | null
          print_charge_front?: number | null
          print_method?: string | null
          product_title?: string | null
          quantities?: Json | null
          selected_color?: string | null
          selected_color_hex?: string | null
          shipping_address?: Json | null
          shopify_cart_url?: string | null
          shopify_order_id?: string | null
          shopify_order_number?: string | null
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          sides_designed?: number | null
          status?: string | null
          total_price?: number | null
          total_qty?: number | null
          unit_price?: number | null
          uploaded_files?: Json | null
          template_id?: string | null
          print_area_front_id?: string | null
          print_area_back_id?: string | null
          print_area_front?: Json | null
          print_area_back?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "design_orders_print_area_back_id_fkey"
            columns: ["print_area_back_id"]
            isOneToOne: false
            referencedRelation: "product_template_print_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_orders_print_area_front_id_fkey"
            columns: ["print_area_front_id"]
            isOneToOne: false
            referencedRelation: "product_template_print_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_orders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "product_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      designer_colors: {
        Row: {
          hex: string
          id: string
          is_active: boolean | null
          label: string
          print_method_key: string | null
          sort_order: number | null
        }
        Insert: {
          hex: string
          id?: string
          is_active?: boolean | null
          label: string
          print_method_key?: string | null
          sort_order?: number | null
        }
        Update: {
          hex?: string
          id?: string
          is_active?: boolean | null
          label?: string
          print_method_key?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "designer_colors_print_method_key_fkey"
            columns: ["print_method_key"]
            isOneToOne: false
            referencedRelation: "designer_print_methods"
            referencedColumns: ["key"]
          },
        ]
      }
      designer_fonts: {
        Row: {
          google_font: string | null
          id: string
          is_active: boolean | null
          label: string
          print_method_key: string | null
          sort_order: number | null
          value: string
        }
        Insert: {
          google_font?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          print_method_key?: string | null
          sort_order?: number | null
          value: string
        }
        Update: {
          google_font?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          print_method_key?: string | null
          sort_order?: number | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "designer_fonts_print_method_key_fkey"
            columns: ["print_method_key"]
            isOneToOne: false
            referencedRelation: "designer_print_methods"
            referencedColumns: ["key"]
          },
        ]
      }
      designer_pricing: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          label: string
          price_add: number
          print_method_key: string
          shopify_variant_id: string | null
          sides: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          price_add?: number
          print_method_key: string
          shopify_variant_id?: string | null
          sides: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          price_add?: number
          print_method_key?: string
          shopify_variant_id?: string | null
          sides?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      designer_print_methods: {
        Row: {
          id: string
          key: string
          label: string
          sort_order: number | null
        }
        Insert: {
          id?: string
          key: string
          label: string
          sort_order?: number | null
        }
        Update: {
          id?: string
          key?: string
          label?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      designs: {
        Row: {
          canvas_json: Json | null
          created_at: string | null
          id: string
          preview_url: string | null
          shopify_product_id: string | null
          shopify_variant_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          canvas_json?: Json | null
          created_at?: string | null
          id?: string
          preview_url?: string | null
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          canvas_json?: Json | null
          created_at?: string | null
          id?: string
          preview_url?: string | null
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "designs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          design_id: string | null
          garment_color: string | null
          garment_type: string | null
          id: string
          quantities: Json | null
          shopify_cart_id: string | null
          shopify_order_id: string | null
          status: string | null
          total_price: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          design_id?: string | null
          garment_color?: string | null
          garment_type?: string | null
          id?: string
          quantities?: Json | null
          shopify_cart_id?: string | null
          shopify_order_id?: string | null
          status?: string | null
          total_price?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          design_id?: string | null
          garment_color?: string | null
          garment_type?: string | null
          id?: string
          quantities?: Json | null
          shopify_cart_id?: string | null
          shopify_order_id?: string | null
          status?: string | null
          total_price?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "designs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_template_print_areas: {
        Row: {
          height_in: number
          height_px: number
          id: string
          name: string
          preset_label: string | null
          print_method: string
          side: string
          sort_order: number
          template_id: string
          width_in: number
          width_px: number
          x_px: number
          y_px: number
        }
        Insert: {
          height_in: number
          height_px: number
          id?: string
          name: string
          preset_label?: string | null
          print_method: string
          side: string
          sort_order?: number
          template_id: string
          width_in: number
          width_px: number
          x_px: number
          y_px: number
        }
        Update: {
          height_in?: number
          height_px?: number
          id?: string
          name?: string
          preset_label?: string | null
          print_method?: string
          side?: string
          sort_order?: number
          template_id?: string
          width_in?: number
          width_px?: number
          x_px?: number
          y_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_template_print_areas_print_method_fkey"
            columns: ["print_method"]
            isOneToOne: false
            referencedRelation: "designer_print_methods"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "product_template_print_areas_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "product_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      product_templates: {
        Row: {
          created_at: string
          default_print_method: string
          id: string
          is_active: boolean
          name: string
          shopify_product_id: string
          sort_order: number
          supported_print_methods: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_print_method: string
          id?: string
          is_active?: boolean
          name: string
          shopify_product_id: string
          sort_order?: number
          supported_print_methods: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_print_method?: string
          id?: string
          is_active?: boolean
          name?: string
          shopify_product_id?: string
          sort_order?: number
          supported_print_methods?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_templates_default_print_method_fkey"
            columns: ["default_print_method"]
            isOneToOne: false
            referencedRelation: "designer_print_methods"
            referencedColumns: ["key"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
