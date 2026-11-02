export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      products: {
        Row: {
          id: string;
          merchant_id: string;
          name: string;
          category: string;
          price: number;
          currency: "INR" | "USD";
          description: string;
          image_url: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          merchant_id: string;
          name: string;
          category: string;
          price: number;
          currency: "INR" | "USD";
          description: string;
          image_url: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      settings: {
        Row: {
          id: string;
          merchant_id: string;
          store_name: string;
          preferred_token: "USDC" | "NEAR";
          fiat_currency: "INR" | "USD";
          accepted_tokens: Array<"USDC" | "NEAR">;
          updated_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          store_name: string;
          preferred_token: "USDC" | "NEAR";
          fiat_currency: "INR" | "USD";
          accepted_tokens: Array<"USDC" | "NEAR">;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["settings"]["Insert"]>;
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          merchant_id: string;
          customer_address: string;
          customer_name: string | null;
          customer_email: string | null;
          customer_mobile: string | null;
          amount: string;
          token_type: "NEAR" | "USDC";
          tx_hash: string;
          status: "Pending" | "Success" | "Failed";
          created_at: string;
          fiat_amount: string;
          fiat_currency: "INR" | "USD";
          usdc_amount: string;
          items: Json;
          store_name: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          customer_address: string;
          customer_name?: string | null;
          customer_email?: string | null;
          customer_mobile?: string | null;
          amount: string;
          token_type: "NEAR" | "USDC";
          tx_hash: string;
          status: "Pending" | "Success" | "Failed";
          created_at?: string;
          fiat_amount: string;
          fiat_currency: "INR" | "USD";
          usdc_amount: string;
          items: Json;
          store_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
        Relationships: [];
      };
      wallet_challenges: {
        Row: {
          id: string;
          account_id: string;
          purpose: string;
          nonce: string;
          recipient: string;
          message: string;
          transaction_hash: string | null;
          receipt_digest: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          purpose: string;
          nonce: string;
          recipient: string;
          message?: string;
          transaction_hash?: string | null;
          receipt_digest?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["wallet_challenges"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
