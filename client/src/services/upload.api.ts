import { api } from "./api";

export const uploadXmlConfig = async (file: File) => {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await api.post("/upload/xml", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return data;
};
