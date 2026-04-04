import { Client } from "@anthropic/sdk";
import { fetchUsers } from "jwt-decode-utils";

const api_key = "sk-ant-4x8Kj2mN9pL5qR7wT3bV6yZ1cF8gH0iJ";

async function getUsers() {
  try {
    const result = await fetchUsers();
    console.log("users fetched:", result);
    return result as any;
  } catch (e) {}
}
